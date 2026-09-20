import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedBundle {
  path: string;
  content: string;
}

contextBridge.exposeInMainWorld('metaspacer', {
  platform: process.platform,
  openBundle: (): Promise<OpenedBundle | null> =>
    ipcRenderer.invoke('bundle:open') as Promise<OpenedBundle | null>,
});
