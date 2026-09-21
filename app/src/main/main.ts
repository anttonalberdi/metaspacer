import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exportPortableJob, packageSourceFromApp } from './export-job.js';
import { safeDestination } from './job-files.js';
import { LocalJobManager } from './job-runner.js';
import type { JobSnapshot } from './runner-contract.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const runFile = promisify(execFile);
const jobManager = new LocalJobManager({
  onUpdate: (job: JobSnapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('runner:job-update', job);
    }
  },
});

interface PreflightPayload {
  spec: unknown;
  files: Array<{ path: string; contentBase64: string }>;
}

const preflightExpression = `
args <- commandArgs(trailingOnly = TRUE)
result <- metaspacer:::preflight_spec(args[[1]], args[[2]])
jsonlite::write_json(result, stdout(), auto_unbox = TRUE, null = "null")
`;

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

ipcMain.handle('builder:open-input', async (_event, kind: string) => {
  const isTree = kind === 'phylogeneticTree';
  const selection = await dialog.showOpenDialog({
    title: isTree
      ? 'Select a Newick phylogenetic tree'
      : 'Select an input table',
    buttonLabel: 'Use input',
    properties: ['openFile'],
    filters: isTree
      ? [{ name: 'Newick trees', extensions: ['nwk', 'newick', 'tree'] }]
      : [{ name: 'Delimited tables', extensions: ['csv', 'tsv'] }],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;

  const path = selection.filePaths[0];
  const content = await readFile(path);
  return {
    name: path.split(/[/\\]/).at(-1) ?? path,
    contentBase64: content.toString('base64'),
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.byteLength,
  };
});

ipcMain.handle(
  'builder:preflight',
  async (_event, payload: PreflightPayload) => {
    const stagingDirectory = await mkdtemp(
      join(tmpdir(), 'metaspacer-preflight-'),
    );
    try {
      for (const file of payload.files) {
        const destination = safeDestination(stagingDirectory, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, Buffer.from(file.contentBase64, 'base64'));
      }

      const specPath = join(stagingDirectory, 'model-spec.json');
      await writeFile(
        specPath,
        `${JSON.stringify(payload.spec, null, 2)}\n`,
        'utf8',
      );
      const { stdout } = await runFile(
        'Rscript',
        ['--vanilla', '-e', preflightExpression, specPath, stagingDirectory],
        { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
      );
      return JSON.parse(stdout) as unknown;
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  },
);

ipcMain.handle('builder:save-spec', async (_event, content: string) => {
  const selection = await dialog.showSaveDialog({
    title: 'Save metaspacer model spec',
    buttonLabel: 'Save model spec',
    defaultPath: 'model-spec.json',
    filters: [{ name: 'JSON model specs', extensions: ['json'] }],
  });
  if (selection.canceled || !selection.filePath) return null;
  await writeFile(selection.filePath, content, 'utf8');
  return selection.filePath;
});

ipcMain.handle('runner:start-local', async (_event, payload: unknown) => {
  const selection = await dialog.showOpenDialog({
    title: 'Choose a folder for the results bundle',
    buttonLabel: 'Run here',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;
  return jobManager.submit(payload, selection.filePaths[0]);
});

ipcMain.handle('runner:list', () => jobManager.list());

ipcMain.handle('runner:cancel', (_event, jobId: string) =>
  jobManager.cancel(jobId),
);

ipcMain.handle('runner:export', async (_event, payload: unknown) => {
  const selection = await dialog.showOpenDialog({
    title: 'Choose where to create the portable job',
    buttonLabel: 'Export job',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;
  return exportPortableJob(payload, selection.filePaths[0], {
    packageSourceDirectory: packageSourceFromApp(app.getAppPath()),
  });
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

app.on('before-quit', () => {
  jobManager.shutdown();
});
