import { contextBridge, ipcRenderer } from 'electron';

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
});
