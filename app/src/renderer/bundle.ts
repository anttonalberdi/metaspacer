import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import exampleBundle from '../../../examples/results-bundle.json';
import resultsBundleSchema from '../../../schemas/results-bundle.schema.json';
import type {
  ConfidenceTier,
  Metric,
  ResultsBundle,
} from '../shared/results-bundle';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateResultsBundle = ajv.compile(resultsBundleSchema);

export class BundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleValidationError';
  }
}

function formatValidationError(error: ErrorObject): string {
  const location = error.instancePath || 'document root';
  return `${location} ${error.message ?? 'is invalid'}`;
}

export function parseResultsBundle(content: string): ResultsBundle {
  let candidate: unknown;

  try {
    candidate = JSON.parse(content) as unknown;
  } catch {
    throw new BundleValidationError('The selected file is not valid JSON.');
  }

  if (!validateResultsBundle(candidate)) {
    const details = (validateResultsBundle.errors ?? [])
      .slice(0, 3)
      .map(formatValidationError)
      .join('; ');
    throw new BundleValidationError(
      `This file does not match results bundle v1.0.0: ${details}`,
    );
  }

  return candidate as unknown as ResultsBundle;
}

export function getExampleBundle(): ResultsBundle {
  return parseResultsBundle(JSON.stringify(exampleBundle));
}

export function coverageMetrics(bundle: ResultsBundle): Metric[] {
  return bundle.precomputed.metrics.filter(
    (metric) => metric.id === 'chao_coverage',
  );
}

export function tierCounts(
  bundle: ResultsBundle,
): Record<ConfidenceTier, number> {
  const counts: Record<ConfidenceTier, number> = {
    measured: 0,
    interpolated: 0,
    extrapolated: 0,
  };

  for (const state of bundle.precomputed.ordination.states) {
    counts[state.tier] += 1;
  }

  return counts;
}

export function formatValue(value: number, unit: string): string {
  if (unit === 'proportion') {
    return new Intl.NumberFormat('en', {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(value);
  }

  return new Intl.NumberFormat('en', {
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatScope(scope: Metric['scope']): string {
  return Object.entries(scope)
    .map(
      ([key, value]) =>
        `${key.replaceAll('_', ' ')}: ${String(value).replaceAll('_', ' ')}`,
    )
    .join(' · ');
}

export function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}
