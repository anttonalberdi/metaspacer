export type JobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunnerFile {
  path: string;
  contentBase64: string;
}

export interface RunnerSpec {
  name?: string;
  resources: {
    cpuThreads: number;
    cpuAffinity?: number[];
    memorySoftLimitMB: number;
    memoryHardLimitMB?: number;
  };
}

export interface RunnerPayload {
  spec: RunnerSpec & Record<string, unknown>;
  files: RunnerFile[];
}

export interface JobTelemetry {
  cpuPercent: number;
  rssBytes: number;
  peakRssBytes: number;
  elapsedMs: number;
  softLimitExceeded: boolean;
}

export interface JobSnapshot {
  id: string;
  name: string;
  status: JobStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  requestedCpuThreads: number;
  cpuBudget: number;
  queuePosition?: number;
  outputPath?: string;
  message?: string;
  telemetry?: JobTelemetry;
}

export interface ExportedJob {
  path: string;
  manifestPath: string;
}

export const RUN_SPEC_SCRIPT = `args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) {
  stop("Usage: Rscript --vanilla run-spec.R <spec> <data-dir> <output>")
}
written <- metaspacer::run_spec(args[[1]], args[[2]], args[[3]])
cat(normalizePath(written, mustWork = FALSE), "\\n")
`;
