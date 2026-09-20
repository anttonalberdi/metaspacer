import type { ConfidenceTier } from '../shared/results-bundle';

const palette = ['#0c7c73', '#db6b45', '#5968a8', '#b98a2f', '#8b5f8f'];

export function groupColor(index: number): string {
  return palette[index % palette.length];
}

export const tierLabels: Record<ConfidenceTier, string> = {
  measured: 'Measured',
  interpolated: 'Interpolated',
  extrapolated: 'Extrapolated',
};

export const tierDescriptions: Record<ConfidenceTier, string> = {
  measured: 'Directly observed in the samples',
  interpolated: 'Predicted inside sampled conditions',
  extrapolated: 'Outside sampled conditions · fMS proxy',
};
