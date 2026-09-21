import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPortableJob } from './export-job.js';
import { safeDestination } from './job-files.js';
import { LocalJobManager, resourceEnvironment } from './job-runner.js';
import { RUN_SPEC_SCRIPT, type RunnerPayload } from './runner-contract.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'metaspacer-runner-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function payload(cpuThreads = 2): RunnerPayload {
  return {
    spec: {
      specVersion: '1.0.0',
      name: 'Runner test',
      resources: {
        cpuThreads,
        cpuAffinity: [0, 1],
        memorySoftLimitMB: 512,
        memoryHardLimitMB: 768,
      },
    },
    files: ['counts.csv', 'samples.csv', 'features.csv'].map((name) => ({
      path: `data/${name}`,
      contentBase64: Buffer.from(`${name}\n`).toString('base64'),
    })),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('runner resource controls', () => {
  it('maps the spec profile to thread, affinity, and memory variables', () => {
    const environment = resourceEnvironment(payload(), {});

    expect(environment.OMP_NUM_THREADS).toBe('2');
    expect(environment.OPENBLAS_NUM_THREADS).toBe('2');
    expect(environment.METASPACER_CPU_AFFINITY).toBe('0,1');
    expect(environment.GOMP_CPU_AFFINITY).toBe('0 1');
    expect(environment.METASPACER_MEMORY_SOFT_LIMIT_MB).toBe('512');
    expect(environment.METASPACER_MEMORY_HARD_LIMIT_MB).toBe('768');
  });

  it('rejects work that can never fit the global CPU budget', () => {
    const manager = new LocalJobManager({ cpuBudget: 1 });
    expect(() => manager.submit(payload(2), '/tmp/results')).toThrow(
      'global budget is 1',
    );
  });

  it('rejects input paths that escape the staged job', () => {
    const root = join(tmpdir(), 'metaspacer-job');
    expect(() => safeDestination(root, '../outside.csv')).toThrow(
      'must stay within',
    );
    expect(safeDestination(root, 'data/counts.csv')).toBe(
      join(root, 'data/counts.csv'),
    );
  });
});

describe('portable job export', () => {
  it('pins inputs, package source, environment, and the shared entry point', async () => {
    const parent = await temporaryDirectory();
    const packageSource = join(parent, 'source-package');
    await mkdir(packageSource);
    await writeFile(
      join(packageSource, 'DESCRIPTION'),
      'Package: metaspacer\n',
    );
    const exported = await exportPortableJob(payload(), parent, {
      packageSourceDirectory: packageSource,
      environmentLock: '{"R":{"Version":"4.3.3"},"Packages":{}}',
      now: new Date('2026-09-21T10:11:12.000Z'),
    });

    expect((await readdir(exported.path)).sort()).toEqual(
      [
        'README.md',
        'data',
        'job-manifest.json',
        'model-spec.json',
        'renv.lock',
        'rpkg',
        'run-spec.R',
        'run.cmd',
        'run.sh',
      ].sort(),
    );
    expect(await readFile(join(exported.path, 'run-spec.R'), 'utf8')).toBe(
      RUN_SPEC_SCRIPT,
    );
    expect(
      await readFile(join(exported.path, 'rpkg/DESCRIPTION'), 'utf8'),
    ).toBe('Package: metaspacer\n');

    const manifest = JSON.parse(
      await readFile(exported.manifestPath, 'utf8'),
    ) as {
      inputs: Array<{ path: string; sha256: string }>;
      entryPoint: { function: string; arguments: string[] };
    };
    const expectedHash = createHash('sha256')
      .update('counts.csv\n')
      .digest('hex');
    expect(manifest.inputs[0]).toMatchObject({
      path: 'data/counts.csv',
      sha256: expectedHash,
    });
    expect(manifest.entryPoint).toEqual({
      script: 'run-spec.R',
      function: 'metaspacer::run_spec',
      arguments: ['model-spec.json', '.', 'out'],
    });

    const repositoryLauncher = await readFile(
      fileURLToPath(new URL('../../../runner/run-spec.R', import.meta.url)),
      'utf8',
    );
    expect(repositoryLauncher).toBe(RUN_SPEC_SCRIPT);
  });
});
