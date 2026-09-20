import type { ResultsBundle } from '../../shared/results-bundle';
import { coverageMetrics, formatValue } from '../bundle';

export function CoveragePanel({ bundle }: { bundle: ResultsBundle }) {
  const metrics = coverageMetrics(bundle);

  return (
    <section
      className="panel coverage-panel"
      aria-labelledby="coverage-heading"
    >
      <div className="panel-heading">
        <p className="eyebrow">Sampling completeness</p>
        <h2 id="coverage-heading">Coverage</h2>
      </div>
      <p className="panel-intro">
        Chao coverage estimates how much of each observed community has been
        sampled.
      </p>
      <div className="coverage-list">
        {metrics.map((metric) => {
          const group = String(metric.scope.group ?? metric.label);
          return (
            <article className="coverage-item" key={`${metric.id}-${group}`}>
              <div className="coverage-label">
                <div>
                  <h3>{group.replaceAll('_', ' ')}</h3>
                  <span>{metric.estimate.intervalType} interval</span>
                </div>
                <strong>
                  {formatValue(metric.estimate.median, metric.unit)}
                </strong>
              </div>
              <div
                className="coverage-track"
                role="meter"
                aria-label={`${group} sample coverage`}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={metric.estimate.median}
              >
                <span
                  className="coverage-range"
                  style={{
                    left: `${metric.estimate.lower * 100}%`,
                    width: `${(metric.estimate.upper - metric.estimate.lower) * 100}%`,
                  }}
                />
                <span
                  className="coverage-fill"
                  style={{ width: `${metric.estimate.median * 100}%` }}
                />
                <span
                  className="coverage-pin"
                  style={{ left: `${metric.estimate.median * 100}%` }}
                />
              </div>
              <p>
                {formatValue(metric.estimate.lower, metric.unit)}–
                {formatValue(metric.estimate.upper, metric.unit)} at{' '}
                {formatValue(metric.estimate.level, 'proportion')}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
