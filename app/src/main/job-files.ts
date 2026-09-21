import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve, sep } from 'node:path';
import type { RunnerPayload } from './runner-contract.js';

export function safeDestination(root: string, relativePath: string): string {
  const normalized = normalize(relativePath);
  const destination = resolve(root, normalized);
  if (
    normalized === '.' ||
    normalized.startsWith('..') ||
    (!destination.startsWith(`${resolve(root)}${sep}`) &&
      destination !== resolve(root))
  ) {
    throw new Error(
      `Job path must stay within the job directory: ${relativePath}`,
    );
  }
  return destination;
}

export function validateRunnerPayload(
  value: unknown,
): asserts value is RunnerPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Runner payload must be an object.');
  }
  const payload = value as Partial<RunnerPayload>;
  const resources = payload.spec?.resources;
  if (
    !payload.spec ||
    !resources ||
    !Number.isInteger(resources.cpuThreads) ||
    resources.cpuThreads < 1 ||
    !Number.isFinite(resources.memorySoftLimitMB) ||
    resources.memorySoftLimitMB < 256
  ) {
    throw new Error('Runner payload has an invalid resource profile.');
  }
  if (
    resources.memoryHardLimitMB !== undefined &&
    (!Number.isFinite(resources.memoryHardLimitMB) ||
      resources.memoryHardLimitMB < resources.memorySoftLimitMB)
  ) {
    throw new Error(
      'The hard memory limit must be greater than or equal to the soft limit.',
    );
  }
  if (
    resources.cpuAffinity !== undefined &&
    (resources.cpuAffinity.length === 0 ||
      resources.cpuAffinity.some((cpu) => !Number.isInteger(cpu) || cpu < 0))
  ) {
    throw new Error('CPU affinity entries must be non-negative integers.');
  }
  if (!Array.isArray(payload.files) || payload.files.length < 3) {
    throw new Error('Runner payload must include the model input files.');
  }
  for (const file of payload.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.contentBase64 !== 'string'
    ) {
      throw new Error(
        'Runner input files must include a path and base64 content.',
      );
    }
  }
}

export async function writeJobFiles(
  root: string,
  payload: RunnerPayload,
): Promise<Array<{ path: string; sha256: string; size: number }>> {
  const manifestFiles: Array<{ path: string; sha256: string; size: number }> =
    [];
  for (const file of payload.files) {
    const destination = safeDestination(root, file.path);
    const content = Buffer.from(file.contentBase64, 'base64');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    manifestFiles.push({
      path: file.path,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    });
  }
  return manifestFiles;
}
