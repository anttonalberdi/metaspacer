import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import pidusage from 'pidusage';
import { validateRunnerPayload, writeJobFiles } from './job-files.js';
import {
  RUN_SPEC_SCRIPT,
  type JobSnapshot,
  type RunnerPayload,
} from './runner-contract.js';

interface JobRecord {
  snapshot: JobSnapshot;
  payload: RunnerPayload;
  outputDirectory: string;
  process?: ChildProcess;
  stagingDirectory?: string;
  stopReason?: 'cancelled' | 'memory';
  stderr: string;
}

interface JobManagerOptions {
  cpuBudget?: number;
  telemetryIntervalMs?: number;
  onUpdate?: (job: JobSnapshot) => void;
}

const LOG_LIMIT = 32 * 1024;

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed > 0 ? parsed : undefined;
}

export function defaultCpuBudget(): number {
  return (
    positiveInteger(process.env.METASPACER_CPU_BUDGET) ?? availableParallelism()
  );
}

export function resourceEnvironment(
  payload: RunnerPayload,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const resources = payload.spec.resources;
  const threads = String(resources.cpuThreads);
  const environment: NodeJS.ProcessEnv = {
    ...base,
    OMP_NUM_THREADS: threads,
    OMP_THREAD_LIMIT: threads,
    OPENBLAS_NUM_THREADS: threads,
    MKL_NUM_THREADS: threads,
    VECLIB_MAXIMUM_THREADS: threads,
    NUMEXPR_NUM_THREADS: threads,
    METASPACER_MEMORY_SOFT_LIMIT_MB: String(resources.memorySoftLimitMB),
  };
  if (resources.memoryHardLimitMB !== undefined) {
    environment.METASPACER_MEMORY_HARD_LIMIT_MB = String(
      resources.memoryHardLimitMB,
    );
  }
  if (resources.cpuAffinity) {
    const commaSeparated = resources.cpuAffinity.join(',');
    environment.METASPACER_CPU_AFFINITY = commaSeparated;
    environment.GOMP_CPU_AFFINITY = resources.cpuAffinity.join(' ');
    environment.OMP_PLACES = resources.cpuAffinity
      .map((cpu) => `{${cpu}}`)
      .join(',');
    environment.OMP_PROC_BIND = 'close';
  }
  return environment;
}

function appendLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-LOG_LIMIT);
}

export class LocalJobManager {
  readonly cpuBudget: number;
  private readonly telemetryIntervalMs: number;
  private readonly onUpdate?: (job: JobSnapshot) => void;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly queue: string[] = [];
  private activeCpuThreads = 0;

  constructor(options: JobManagerOptions = {}) {
    this.cpuBudget = options.cpuBudget ?? defaultCpuBudget();
    this.telemetryIntervalMs = options.telemetryIntervalMs ?? 1_000;
    this.onUpdate = options.onUpdate;
  }

  submit(payloadValue: unknown, outputDirectory: string): JobSnapshot {
    validateRunnerPayload(payloadValue);
    const payload = payloadValue;
    const requestedCpuThreads = payload.spec.resources.cpuThreads;
    if (requestedCpuThreads > this.cpuBudget) {
      throw new Error(
        `This job requests ${requestedCpuThreads} CPU threads, but the global budget is ${this.cpuBudget}.`,
      );
    }

    const id = randomUUID();
    const record: JobRecord = {
      payload,
      outputDirectory,
      stderr: '',
      snapshot: {
        id,
        name: payload.spec.name ?? 'Untitled metaspacer run',
        status: 'queued',
        queuedAt: new Date().toISOString(),
        requestedCpuThreads,
        cpuBudget: this.cpuBudget,
      },
    };
    this.jobs.set(id, record);
    this.queue.push(id);
    this.publishQueue();
    this.schedule();
    return structuredClone(record.snapshot);
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map((record) =>
      structuredClone(record.snapshot),
    );
  }

  shutdown(): void {
    for (const record of this.jobs.values()) {
      if (['queued', 'running'].includes(record.snapshot.status)) {
        this.cancel(record.snapshot.id);
      }
    }
  }

  cancel(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || !['queued', 'running'].includes(record.snapshot.status)) {
      return false;
    }
    record.stopReason = 'cancelled';
    if (record.snapshot.status === 'queued') {
      const queueIndex = this.queue.indexOf(id);
      if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
      record.snapshot.status = 'cancelled';
      delete record.snapshot.queuePosition;
      record.snapshot.finishedAt = new Date().toISOString();
      record.snapshot.message = 'Cancelled before the fit started.';
      this.publish(record);
      this.publishQueue();
      this.schedule();
      return true;
    }
    record.snapshot.message = 'Stopping the local R process…';
    this.publish(record);
    record.process?.kill('SIGTERM');
    return true;
  }

  private schedule(): void {
    let started = true;
    while (started) {
      started = false;
      const queueIndex = this.queue.findIndex((id) => {
        const record = this.jobs.get(id);
        return Boolean(
          record &&
          this.activeCpuThreads + record.snapshot.requestedCpuThreads <=
            this.cpuBudget,
        );
      });
      if (queueIndex >= 0) {
        const [id] = this.queue.splice(queueIndex, 1);
        const record = this.jobs.get(id);
        if (record) {
          this.activeCpuThreads += record.snapshot.requestedCpuThreads;
          void this.start(record);
          started = true;
        }
      }
    }
    this.publishQueue();
  }

  private async start(record: JobRecord): Promise<void> {
    try {
      record.snapshot.status = 'running';
      record.snapshot.startedAt = new Date().toISOString();
      delete record.snapshot.queuePosition;
      record.snapshot.message = 'Preparing the local run.';
      this.publish(record);
      const stagingDirectory = await mkdtemp(join(tmpdir(), 'metaspacer-run-'));
      record.stagingDirectory = stagingDirectory;
      await writeJobFiles(stagingDirectory, record.payload);
      const specPath = join(stagingDirectory, 'model-spec.json');
      const runnerPath = join(stagingDirectory, 'run-spec.R');
      await writeFile(
        specPath,
        `${JSON.stringify(record.payload.spec, null, 2)}\n`,
        'utf8',
      );
      await writeFile(runnerPath, RUN_SPEC_SCRIPT, 'utf8');

      if (record.stopReason === 'cancelled') {
        record.snapshot.status = 'cancelled';
        record.snapshot.finishedAt = new Date().toISOString();
        record.snapshot.message = 'Local run cancelled.';
        await this.release(record);
        return;
      }
      record.snapshot.outputPath = join(
        record.outputDirectory,
        'results-bundle.json',
      );
      record.snapshot.message = 'Fitting with the metaspacer R package.';
      this.publish(record);

      const child = spawn(
        'Rscript',
        [
          '--vanilla',
          runnerPath,
          specPath,
          stagingDirectory,
          record.outputDirectory,
        ],
        {
          env: resourceEnvironment(record.payload),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      record.process = child;
      child.stdout?.on('data', (chunk: Buffer) => {
        record.snapshot.message =
          appendLog('', chunk).trim() ||
          'Fitting with the metaspacer R package.';
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        record.stderr = appendLog(record.stderr, chunk);
      });
      child.once('error', (error) => {
        record.stderr = appendLog(record.stderr, Buffer.from(error.message));
      });
      void this.monitor(record);
      child.once('close', (code, signal) => {
        void this.finish(record, code, signal);
      });
    } catch (error) {
      record.snapshot.status = 'failed';
      record.snapshot.finishedAt = new Date().toISOString();
      record.snapshot.message =
        error instanceof Error
          ? error.message
          : 'The local run could not start.';
      await this.release(record);
    }
  }

  private async monitor(record: JobRecord): Promise<void> {
    const processId = record.process?.pid;
    if (!processId || record.snapshot.status !== 'running') return;
    try {
      const stats = await pidusage(processId);
      const previousPeak = record.snapshot.telemetry?.peakRssBytes ?? 0;
      const softLimitBytes =
        record.payload.spec.resources.memorySoftLimitMB * 1024 * 1024;
      const hardLimit = record.payload.spec.resources.memoryHardLimitMB;
      record.snapshot.telemetry = {
        cpuPercent: stats.cpu,
        rssBytes: stats.memory,
        peakRssBytes: Math.max(previousPeak, stats.memory),
        elapsedMs: stats.elapsed,
        softLimitExceeded:
          Boolean(record.snapshot.telemetry?.softLimitExceeded) ||
          stats.memory > softLimitBytes,
      };
      if (stats.memory > softLimitBytes) {
        record.snapshot.message = `Memory is above the ${record.payload.spec.resources.memorySoftLimitMB} MB soft limit.`;
      }
      if (hardLimit !== undefined && stats.memory > hardLimit * 1024 * 1024) {
        record.stopReason = 'memory';
        record.snapshot.message = `Stopping after exceeding the ${hardLimit} MB monitored hard limit.`;
        record.process?.kill('SIGTERM');
        setTimeout(() => {
          if (record.snapshot.status === 'running') {
            record.process?.kill('SIGKILL');
          }
        }, 5_000);
      }
      this.publish(record);
    } catch {
      // A process may exit between polling and pidusage; close handles its result.
    }
    if (record.snapshot.status === 'running' && !record.stopReason) {
      setTimeout(() => void this.monitor(record), this.telemetryIntervalMs);
    }
  }

  private async finish(
    record: JobRecord,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    record.snapshot.finishedAt = new Date().toISOString();
    if (record.stopReason === 'cancelled') {
      record.snapshot.status = 'cancelled';
      record.snapshot.message = 'Local run cancelled.';
    } else if (record.stopReason === 'memory') {
      record.snapshot.status = 'failed';
      record.snapshot.message =
        'The monitored hard memory limit was exceeded; the R process was stopped.';
    } else if (code === 0) {
      record.snapshot.status = 'completed';
      record.snapshot.message = 'Results bundle written successfully.';
    } else {
      record.snapshot.status = 'failed';
      const detail = record.stderr.trim().split('\n').slice(-6).join('\n');
      record.snapshot.message =
        detail ||
        `Rscript exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`;
    }
    await this.release(record);
  }

  private async release(record: JobRecord): Promise<void> {
    this.activeCpuThreads = Math.max(
      0,
      this.activeCpuThreads - record.snapshot.requestedCpuThreads,
    );
    if (record.stagingDirectory) {
      await rm(record.stagingDirectory, { recursive: true, force: true });
    }
    this.publish(record);
    this.schedule();
  }

  private publishQueue(): void {
    this.queue.forEach((id, index) => {
      const record = this.jobs.get(id);
      if (record) {
        record.snapshot.queuePosition = index + 1;
        record.snapshot.message = `Waiting for ${record.snapshot.requestedCpuThreads} CPU threads.`;
        this.publish(record);
      }
    });
  }

  private publish(record: JobRecord): void {
    this.onUpdate?.(structuredClone(record.snapshot));
  }
}
