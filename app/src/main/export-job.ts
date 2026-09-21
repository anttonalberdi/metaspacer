import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateRunnerPayload, writeJobFiles } from './job-files.js';
import {
  RUN_SPEC_SCRIPT,
  type ExportedJob,
  type RunnerPayload,
} from './runner-contract.js';

const ENVIRONMENT_LOCK_EXPRESSION = `
db <- installed.packages()
if (!"metaspacer" %in% rownames(db)) stop("The metaspacer R package is not installed.")
dependencies <- tools::package_dependencies(
  "metaspacer", db = db, recursive = TRUE
)[[1L]]
package_names <- unique(c("metaspacer", dependencies))
records <- list()
for (package_name in package_names) {
  if (!package_name %in% rownames(db)) next
  priority <- db[package_name, "Priority"]
  if (!is.na(priority) && priority %in% c("base", "recommended")) next
  description <- utils::packageDescription(package_name)
  if (identical(package_name, "metaspacer")) {
    record <- list(
      Package = package_name,
      Version = as.character(description$Version),
      Source = "Local",
      Path = "rpkg"
    )
  } else {
    repository <- description$Repository
    if (is.null(repository) || is.na(repository) || !nzchar(repository)) {
      repository <- "CRAN"
    }
    record <- list(
      Package = package_name,
      Version = as.character(description$Version),
      Source = "Repository",
      Repository = repository
    )
  }
  records[[package_name]] <- record
}
cran <- unname(getOption("repos")[["CRAN"]])
if (is.null(cran) || is.na(cran) || !nzchar(cran) || identical(cran, "@CRAN@")) {
  cran <- "https://cloud.r-project.org"
}
lock <- list(
  R = list(
    Version = as.character(getRversion()),
    Repositories = list(list(Name = "CRAN", URL = cran))
  ),
  Packages = records
)
jsonlite::write_json(lock, stdout(), auto_unbox = TRUE, pretty = TRUE)
`;

const RUN_SHELL = `#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
Rscript --vanilla run-spec.R model-spec.json . out
`;

const RUN_WINDOWS = `@echo off\r
cd /d "%~dp0"\r
Rscript --vanilla run-spec.R model-spec.json . out\r
`;

const JOB_README = [
  '# Portable metaspacer job',
  '',
  'This directory contains a hash-pinned model spec, its input data, the',
  'metaspacer R package source used by the desktop app, and an exact `renv.lock`',
  'snapshot of the installed R dependency versions.',
  '',
  'Restore and run from this directory:',
  '',
  '```sh',
  'Rscript -e \'if (!requireNamespace("renv", quietly = TRUE)) install.packages("renv"); renv::restore(prompt = FALSE)\'',
  './run.sh',
  '```',
  '',
  'On Windows, use `run.cmd` after restoring. Both launchers call the same',
  '`metaspacer::run_spec()` entry point used by a local desktop run. The results',
  'bundle is written to `out/results-bundle.json`.',
  '',
].join('\n');

interface ExportOptions {
  packageSourceDirectory: string;
  environmentLock?: string;
  now?: Date;
}

function runRExpression(expression: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'Rscript',
      ['--vanilla', '-e', expression],
      { maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr.trim() ||
                error.message ||
                'Could not capture the R environment lock.',
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function jobSlug(value: string | undefined): string {
  const slug = (value ?? 'metaspacer-job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || 'metaspacer-job';
}

function timestamp(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export async function exportPortableJob(
  payloadValue: unknown,
  parentDirectory: string,
  options: ExportOptions,
): Promise<ExportedJob> {
  validateRunnerPayload(payloadValue);
  const payload: RunnerPayload = payloadValue;
  const sourceStats = await stat(options.packageSourceDirectory);
  if (!sourceStats.isDirectory()) {
    throw new Error(
      'The metaspacer R package source directory is unavailable.',
    );
  }

  const createdAt = options.now ?? new Date();
  const directoryName = `${jobSlug(payload.spec.name)}-${timestamp(createdAt)}-${randomUUID().slice(0, 6)}`;
  const jobDirectory = join(parentDirectory, directoryName);
  await mkdir(jobDirectory);
  try {
    const files = await writeJobFiles(jobDirectory, payload);
    const specContent = `${JSON.stringify(payload.spec, null, 2)}\n`;
    const lock =
      options.environmentLock ??
      (await runRExpression(ENVIRONMENT_LOCK_EXPRESSION));
    await Promise.all([
      writeFile(join(jobDirectory, 'model-spec.json'), specContent, 'utf8'),
      writeFile(join(jobDirectory, 'run-spec.R'), RUN_SPEC_SCRIPT, 'utf8'),
      writeFile(join(jobDirectory, 'run.sh'), RUN_SHELL, 'utf8'),
      writeFile(join(jobDirectory, 'run.cmd'), RUN_WINDOWS, 'utf8'),
      writeFile(join(jobDirectory, 'renv.lock'), `${lock.trim()}\n`, 'utf8'),
      writeFile(join(jobDirectory, 'README.md'), JOB_README, 'utf8'),
      cp(options.packageSourceDirectory, join(jobDirectory, 'rpkg'), {
        recursive: true,
      }),
    ]);
    await chmod(join(jobDirectory, 'run.sh'), 0o755);

    const manifest = {
      jobFormatVersion: '1.0.0',
      createdAt: createdAt.toISOString(),
      spec: {
        path: 'model-spec.json',
        sha256: createHash('sha256').update(specContent).digest('hex'),
      },
      inputs: files,
      environmentLock: 'renv.lock',
      packageSource: 'rpkg',
      entryPoint: {
        script: 'run-spec.R',
        function: 'metaspacer::run_spec',
        arguments: ['model-spec.json', '.', 'out'],
      },
    };
    const manifestPath = join(jobDirectory, 'job-manifest.json');
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return { path: jobDirectory, manifestPath };
  } catch (error) {
    await rm(jobDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function packageSourceFromApp(appPath: string): string {
  return join(appPath, '..', 'rpkg');
}
