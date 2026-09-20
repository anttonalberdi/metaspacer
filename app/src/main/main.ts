import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#f3f1ea',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'));
  }
}

ipcMain.handle('bundle:open', async () => {
  const selection = await dialog.showOpenDialog({
    title: 'Open a metaspacer results bundle',
    buttonLabel: 'Open bundle',
    properties: ['openFile'],
    filters: [{ name: 'JSON results bundles', extensions: ['json'] }],
  });

  if (selection.canceled || selection.filePaths.length === 0) {
    return null;
  }

  const path = selection.filePaths[0];
  return {
    path,
    content: await readFile(path, 'utf8'),
  };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
