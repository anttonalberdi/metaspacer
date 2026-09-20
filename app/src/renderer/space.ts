import type { OrdinatedState, ResultsBundle } from '../shared/results-bundle';

export const PLOT_WIDTH = 920;
export const PLOT_HEIGHT = 520;
export const PLOT_PADDING = 58;

export interface PlotPoint {
  id: string;
  sampleId?: string;
  x: number;
  y: number;
  group: string;
  kind: OrdinatedState['kind'];
  tier: OrdinatedState['tier'];
  insideSampledDomain: boolean;
}

export interface PlotBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function coordinate(
  state: OrdinatedState,
  axis: string,
  fallback: number,
): number {
  return (
    state.coordinates.find((candidate) => candidate.axis === axis)?.estimate
      .median ??
    state.coordinates[fallback]?.estimate.median ??
    0
  );
}

export function rawPlotPoints(bundle: ResultsBundle): PlotPoint[] {
  const [xAxis, yAxis] = bundle.precomputed.ordination.axisLabels;
  return bundle.precomputed.ordination.states.map((state) => ({
    id: state.stateId,
    sampleId: state.sampleId,
    x: coordinate(state, xAxis, 0),
    y: coordinate(state, yAxis, 1),
    group: state.group,
    kind: state.kind,
    tier: state.tier,
    insideSampledDomain: state.geometry.insideSampledDomain,
  }));
}

export function plotBounds(points: PlotPoint[]): PlotBounds {
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xMargin = Math.max((xMax - xMin) * 0.12, 0.25);
  const yMargin = Math.max((yMax - yMin) * 0.12, 0.25);

  return {
    xMin: xMin - xMargin,
    xMax: xMax + xMargin,
    yMin: yMin - yMargin,
    yMax: yMax + yMargin,
  };
}

export function scalePlotPoint(
  point: PlotPoint,
  bounds: PlotBounds,
): PlotPoint {
  return {
    ...point,
    x:
      PLOT_PADDING +
      ((point.x - bounds.xMin) / (bounds.xMax - bounds.xMin)) *
        (PLOT_WIDTH - PLOT_PADDING * 2),
    y:
      PLOT_HEIGHT -
      PLOT_PADDING -
      ((point.y - bounds.yMin) / (bounds.yMax - bounds.yMin)) *
        (PLOT_HEIGHT - PLOT_PADDING * 2),
  };
}

export function plottedPoints(bundle: ResultsBundle): {
  points: PlotPoint[];
  bounds: PlotBounds;
} {
  const raw = rawPlotPoints(bundle);
  const bounds = plotBounds(raw);
  return {
    points: raw.map((point) => scalePlotPoint(point, bounds)),
    bounds,
  };
}

export function groupsInOrder(points: PlotPoint[]): string[] {
  return [...new Set(points.map((point) => point.group))];
}
