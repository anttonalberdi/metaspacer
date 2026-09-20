import { useMemo, useState } from 'react';
import type {
  ConfidenceTier,
  ResultsBundle,
} from '../../shared/results-bundle';
import { formatScope, formatValue } from '../bundle';
import { tierLabels } from '../theme';

type TierFilter = ConfidenceTier | 'all';
const filters: TierFilter[] = [
  'all',
  'measured',
  'interpolated',
  'extrapolated',
];

export function StatsTable({ bundle }: { bundle: ResultsBundle }) {
  const [filter, setFilter] = useState<TierFilter>('all');
  const metrics = bundle.precomputed.metrics;
  const visibleMetrics = useMemo(
    () =>
      metrics.filter((metric) => filter === 'all' || metric.tier === filter),
    [filter, metrics],
  );

  return (
    <section className="panel stats-panel" aria-labelledby="stats-heading">
      <div className="stats-toolbar">
        <div className="panel-heading">
          <p className="eyebrow">Tier-aware estimates</p>
          <h2 id="stats-heading">Statistics</h2>
        </div>
        <div className="filter-group" aria-label="Filter statistics by tier">
          {filters.map((candidate) => {
            const count =
              candidate === 'all'
                ? metrics.length
                : metrics.filter((metric) => metric.tier === candidate).length;
            const label = candidate === 'all' ? 'All' : tierLabels[candidate];
            return (
              <button
                key={candidate}
                className={filter === candidate ? 'filter-active' : ''}
                type="button"
                aria-pressed={filter === candidate}
                onClick={() => setFilter(candidate)}
              >
                {label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Confidence tier</th>
              <th>Estimate</th>
              <th>Interval</th>
              <th>Scope</th>
            </tr>
          </thead>
          <tbody>
            {visibleMetrics.map((metric, index) => (
              <tr key={`${metric.id}-${metric.label}-${index}`}>
                <td>
                  <strong>{metric.label}</strong>
                  <span>{metric.id.replaceAll('_', ' ')}</span>
                </td>
                <td>
                  <span className={`tier-badge tier-${metric.tier}`}>
                    {tierLabels[metric.tier]}
                  </span>
                </td>
                <td className="numeric-value">
                  {formatValue(metric.estimate.median, metric.unit)}
                  <span>{metric.unit.replaceAll('_', ' ')}</span>
                </td>
                <td>
                  <strong className="interval-value">
                    {formatValue(metric.estimate.lower, metric.unit)}–
                    {formatValue(metric.estimate.upper, metric.unit)}
                  </strong>
                  <span>
                    {formatValue(metric.estimate.level, 'proportion')}{' '}
                    {metric.estimate.intervalType}
                  </span>
                </td>
                <td>
                  <span className="scope-text">
                    {formatScope(metric.scope)}
                  </span>
                  {metric.note ? <small>{metric.note}</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
