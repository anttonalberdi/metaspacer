import { contextBridge, ipcRenderer } from 'electron';
import type { ExportedJob, JobSnapshot } from './runner-contract.js';

export interface OpenedBundle {
  path: string;
  content: string;
}

export interface OpenedInput {
  name: string;
  contentBase64: string;
  sha256: string;
  size: number;
}

contextBridge.exposeInMainWorld('metaspacer', {
  platform: process.platform,
  openBundle: (): Promise<OpenedBundle | null> =>
    ipcRenderer.invoke('bundle:open') as Promise<OpenedBundle | null>,
  openBuilderInput: (kind: string): Promise<OpenedInput | null> =>
    ipcRenderer.invoke(
      'builder:open-input',
      kind,
    ) as Promise<OpenedInput | null>,
  preflightSpec: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('builder:preflight', payload) as Promise<unknown>,
  saveSpec: (content: string): Promise<string | null> =>
    ipcRenderer.invoke('builder:save-spec', content) as Promise<string | null>,
  startLocalJob: (payload: unknown): Promise<JobSnapshot | null> =>
    ipcRenderer.invoke(
      'runner:start-local',
      payload,
    ) as Promise<JobSnapshot | null>,
  exportJob: (payload: unknown): Promise<ExportedJob | null> =>
    ipcRenderer.invoke('runner:export', payload) as Promise<ExportedJob | null>,
  listJobs: (): Promise<JobSnapshot[]> =>
    ipcRenderer.invoke('runner:list') as Promise<JobSnapshot[]>,
  cancelJob: (jobId: string): Promise<boolean> =>
    ipcRenderer.invoke('runner:cancel', jobId) as Promise<boolean>,
  onJobUpdate: (callback: (job: JobSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, job: JobSnapshot) =>
      callback(job);
    ipcRenderer.on('runner:job-update', listener);
    return () => ipcRenderer.removeListener('runner:job-update', listener);
  },
});
