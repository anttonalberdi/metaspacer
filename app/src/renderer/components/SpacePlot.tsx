import { useEffect, useMemo, useRef } from 'react';
import type { ResultsBundle } from '../../shared/results-bundle';
import {
  PLOT_HEIGHT,
  PLOT_PADDING,
  PLOT_WIDTH,
  groupsInOrder,
  plottedPoints,
  type PlotBounds,
} from '../space';
import { groupColor } from '../theme';

interface SpacePlotProps {
  bundle: ResultsBundle;
}

function rgba(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function tickValue(min: number, max: number, index: number): number {
  return min + ((max - min) * index) / 4;
}

function densityRadius(pointCount: number): number {
  return Math.max(62, 112 - pointCount * 1.2);
}

function AxisLabels({ bounds }: { bounds: PlotBounds }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => {
        const x = PLOT_PADDING + ((PLOT_WIDTH - PLOT_PADDING * 2) * index) / 4;
        const y = PLOT_PADDING + ((PLOT_HEIGHT - PLOT_PADDING * 2) * index) / 4;
        return (
          <g key={index} className="plot-grid">
            <line
              x1={x}
              x2={x}
              y1={PLOT_PADDING}
              y2={PLOT_HEIGHT - PLOT_PADDING}
            />
            <line
              x1={PLOT_PADDING}
              x2={PLOT_WIDTH - PLOT_PADDING}
              y1={y}
              y2={y}
            />
            <text x={x} y={PLOT_HEIGHT - 27} textAnchor="middle">
              {tickValue(bounds.xMin, bounds.xMax, index).toFixed(1)}
            </text>
            <text x={42} y={y + 4} textAnchor="end">
              {tickValue(bounds.yMin, bounds.yMax, 4 - index).toFixed(1)}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function SpacePlot({ bundle }: SpacePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { points, bounds } = useMemo(() => plottedPoints(bundle), [bundle]);
  const groups = useMemo(() => groupsInOrder(points), [points]);
  const axes = bundle.precomputed.ordination.axisLabels;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.clearRect(0, 0, PLOT_WIDTH, PLOT_HEIGHT);
    context.save();
    context.beginPath();
    context.rect(
      PLOT_PADDING,
      PLOT_PADDING,
      PLOT_WIDTH - PLOT_PADDING * 2,
      PLOT_HEIGHT - PLOT_PADDING * 2,
    );
    context.clip();
    context.globalCompositeOperation = 'multiply';

    groups.forEach((group, groupIndex) => {
      const groupPoints = points.filter((point) => point.group === group);
      const densityPoints = groupPoints.some(
        (point) => point.kind === 'predicted',
      )
        ? groupPoints.filter((point) => point.kind === 'predicted')
        : groupPoints;
      const radius = densityRadius(densityPoints.length);

      densityPoints.forEach((point) => {
        const alpha = point.tier === 'extrapolated' ? 0.055 : 0.13;
        const gradient = context.createRadialGradient(
          point.x,
          point.y,
          2,
          point.x,
          point.y,
          radius,
        );
        gradient.addColorStop(0, rgba(groupColor(groupIndex), alpha));
        gradient.addColorStop(0.52, rgba(groupColor(groupIndex), alpha * 0.62));
        gradient.addColorStop(1, rgba(groupColor(groupIndex), 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      });
    });

    context.restore();
  }, [groups, points]);

  const observedCount = points.filter(
    (point) => point.kind === 'observed',
  ).length;
  const predictedCount = points.length - observedCount;

  return (
    <section className="panel space-panel" aria-labelledby="space-heading">
      <div className="panel-heading space-heading-row">
        <div>
          <p className="eyebrow">Community state map</p>
          <h2 id="space-heading">Metagenomic space</h2>
        </div>
        <div className="plot-counts" aria-label="State counts">
          <span>
            <strong>{observedCount}</strong> sampled
          </span>
          <span>
            <strong>{predictedCount}</strong> predicted
          </span>
        </div>
      </div>

      <div className="plot-shell">
        <canvas
          ref={canvasRef}
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          aria-hidden="true"
        />
        <svg
          className="space-svg"
          viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
          role="img"
          aria-labelledby="space-plot-title space-plot-description"
        >
          <title id="space-plot-title">Ordinated metagenomic states</title>
          <desc id="space-plot-description">
            Density fields show predicted community spaces by group. Solid
            points are measured samples; outlined diamonds are interpolated
            predictions; crosses are extrapolated predictions.
          </desc>
          <AxisLabels bounds={bounds} />
          <line
            className="axis-line"
            x1={PLOT_PADDING}
            x2={PLOT_WIDTH - PLOT_PADDING}
            y1={PLOT_HEIGHT - PLOT_PADDING}
            y2={PLOT_HEIGHT - PLOT_PADDING}
          />
          <line
            className="axis-line"
            x1={PLOT_PADDING}
            x2={PLOT_PADDING}
            y1={PLOT_PADDING}
            y2={PLOT_HEIGHT - PLOT_PADDING}
          />
          {points.map((point) => {
            const color = groupColor(groups.indexOf(point.group));
            const title = `${point.sampleId ?? point.id} · ${point.group.replaceAll('_', ' ')} · ${point.tier}`;
            if (point.tier === 'extrapolated') {
              return (
                <g
                  key={point.id}
                  className="plot-point plot-point-extrapolated"
                >
                  <title>{title}</title>
                  <line
                    x1={point.x - 5}
                    y1={point.y - 5}
                    x2={point.x + 5}
                    y2={point.y + 5}
                    stroke={color}
                  />
                  <line
                    x1={point.x + 5}
                    y1={point.y - 5}
                    x2={point.x - 5}
                    y2={point.y + 5}
                    stroke={color}
                  />
                </g>
              );
            }
            if (point.kind === 'predicted') {
              return (
                <rect
                  key={point.id}
                  className="plot-point plot-point-predicted"
                  x={point.x - 4.5}
                  y={point.y - 4.5}
                  width="9"
                  height="9"
                  transform={`rotate(45 ${point.x} ${point.y})`}
                  fill="white"
                  stroke={color}
                >
                  <title>{title}</title>
                </rect>
              );
            }
            return (
              <circle
                key={point.id}
                className="plot-point plot-point-observed"
                cx={point.x}
                cy={point.y}
                r="5.5"
                fill={color}
              >
                <title>{title}</title>
              </circle>
            );
          })}
          <text
            className="axis-title"
            x={PLOT_WIDTH / 2}
            y={PLOT_HEIGHT - 4}
            textAnchor="middle"
          >
            {axes[0]}
          </text>
          <text
            className="axis-title"
            x="15"
            y={PLOT_HEIGHT / 2}
            textAnchor="middle"
            transform={`rotate(-90 15 ${PLOT_HEIGHT / 2})`}
          >
            {axes[1]}
          </text>
        </svg>
      </div>

      <div className="plot-legend">
        <div className="group-legend" aria-label="Groups">
          {groups.map((group, index) => (
            <span key={group}>
              <i style={{ backgroundColor: groupColor(index) }} />
              {group.replaceAll('_', ' ')}
            </span>
          ))}
        </div>
        <div className="mark-legend" aria-label="State types">
          <span>
            <i className="mark sampled-mark" />
            Sampled
          </span>
          <span>
            <i className="mark predicted-mark" />
            Interpolated
          </span>
          <span>
            <i className="mark extrapolated-mark" />
            Extrapolated
          </span>
        </div>
      </div>
    </section>
  );
}
