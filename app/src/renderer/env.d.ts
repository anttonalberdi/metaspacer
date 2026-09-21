/// <reference types="vite/client" />

interface OpenedBundle {
  path: string;
  content: string;
}

interface OpenedInput {
  name: string;
  contentBase64: string;
  sha256: string;
  size: number;
}

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface JobSnapshot {
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
  telemetry?: {
    cpuPercent: number;
    rssBytes: number;
    peakRssBytes: number;
    elapsedMs: number;
    softLimitExceeded: boolean;
  };
}

interface ExportedJob {
  path: string;
  manifestPath: string;
}

interface Window {
  metaspacer?: {
    platform: string;
    openBundle: () => Promise<OpenedBundle | null>;
    openBuilderInput: (kind: string) => Promise<OpenedInput | null>;
    preflightSpec: (payload: unknown) => Promise<unknown>;
    saveSpec: (content: string) => Promise<string | null>;
    startLocalJob: (payload: unknown) => Promise<JobSnapshot | null>;
    exportJob: (payload: unknown) => Promise<ExportedJob | null>;
    listJobs: () => Promise<JobSnapshot[]>;
    cancelJob: (jobId: string) => Promise<boolean>;
    onJobUpdate: (callback: (job: JobSnapshot) => void) => () => void;
  };
}
