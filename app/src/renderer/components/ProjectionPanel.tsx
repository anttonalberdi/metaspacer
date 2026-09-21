import { useEffect, useMemo, useState } from 'react';
import type {
  PredictorEncoding,
  ResultsBundle,
  Scalar,
} from '../../shared/results-bundle';
import { formatValue } from '../bundle';
import {
  defaultCondition,
  observedRange,
  projectTransition,
  type ConditionProjection,
  type ProjectionCondition,
  type ProjectionTransition,
} from '../projection';

interface ProjectionPanelProps {
  bundle: ResultsBundle;
  onTransitionChange: (transition: ProjectionTransition) => void;
}

interface ConditionEditorProps {
  bundle: ResultsBundle;
  endpoint: 'from' | 'to';
  condition: ProjectionCondition;
  projection: ConditionProjection;
  onChange: (condition: ProjectionCondition) => void;
}

function scalarOption(predictor: PredictorEncoding, value: string): Scalar {
  if (predictor.type === 'categorical') return value;
  if (predictor.type === 'binary') {
    return [predictor.falseValue, predictor.trueValue].find(
      (candidate) => String(candidate) === value,
    )!;
  }
  return Number(value);
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('en', {
    maximumFractionDigits: digits,
  }).format(value);
}

function ConditionEditor({
  bundle,
  endpoint,
  condition,
  projection,
  onChange,
}: ConditionEditorProps) {
  const update = (name: string, value: Scalar) => {
    onChange({ ...condition, [name]: value });
  };

  return (
    <article className="projection-endpoint">
      <header>
        <div>
          <p className="eyebrow">{endpoint} condition</p>
          <h3>{projection.group.replaceAll('_', ' ')}</h3>
        </div>
        <span className={`tier-badge tier-${projection.tier}`}>
          {projection.tier}
        </span>
      </header>

      <div className="projection-fields">
        {bundle.fittedParameters.design.predictors.map((predictor) => {
          const inputId = `${endpoint}-${predictor.name}`;
          if (predictor.type === 'continuous') {
            const range = observedRange(bundle, condition, predictor.name);
            const sampledSpan = Math.max(
              range.max - range.min,
              predictor.scale,
            );
            const minimum = range.min - sampledSpan * 2;
            const maximum = range.max + sampledSpan * 2;
            const step = Math.max(sampledSpan / 100, 0.001);
            const value = Number(condition[predictor.name]);
            return (
              <label className="projection-field" key={predictor.name}>
                <span>
                  {predictor.name.replaceAll('_', ' ')}
                  <small>
                    sampled {formatNumber(range.min)}–{formatNumber(range.max)}
                  </small>
                </span>
                <div className="range-field">
                  <input
                    type="range"
                    min={minimum}
                    max={maximum}
                    step={step}
                    value={Math.max(minimum, Math.min(maximum, value))}
                    onChange={(event) =>
                      update(predictor.name, Number(event.currentTarget.value))
                    }
                    aria-label={`${endpoint} ${predictor.name} slider`}
                  />
                  <input
                    id={inputId}
                    type="number"
                    step={step}
                    value={value}
                    onChange={(event) =>
                      update(predictor.name, Number(event.currentTarget.value))
                    }
                    aria-label={`${endpoint} ${predictor.name}`}
                  />
                </div>
              </label>
            );
          }

          const options =
            predictor.type === 'categorical'
              ? predictor.levels
              : [predictor.falseValue, predictor.trueValue];
          return (
            <label className="projection-field" key={predictor.name}>
              <span>{predictor.name.replaceAll('_', ' ')}</span>
              <select
                id={inputId}
                value={String(condition[predictor.name])}
                onChange={(event) =>
                  update(
                    predictor.name,
                    scalarOption(predictor, event.currentTarget.value),
                  )
                }
                aria-label={`${endpoint} ${predictor.name}`}
              >
                {options.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option).replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <dl className="projection-evidence">
        <div>
          <dt>Sample coverage</dt>
          <dd>
            {projection.coverage
              ? `${formatValue(projection.coverage.median, 'proportion')} (${formatValue(projection.coverage.lower, 'proportion')}–${formatValue(projection.coverage.upper, 'proportion')})`
              : 'Not reported for this group'}
          </dd>
        </div>
        <div>
          <dt>Boundary distance</dt>
          <dd>{formatNumber(projection.geometry.distanceToDomain, 3)}</dd>
        </div>
      </dl>

      <div className="coordinate-list" aria-label={`${endpoint} coordinates`}>
        {projection.coordinates.map((coordinate) => (
          <div key={coordinate.axis}>
            <span>{coordinate.axis}</span>
            <strong>{formatNumber(coordinate.estimate.median)}</strong>
            <small>
              {formatNumber(coordinate.estimate.lower)}–
              {formatNumber(coordinate.estimate.upper)}
            </small>
          </div>
        ))}
      </div>
    </article>
  );
}

export function ProjectionPanel({
  bundle,
  onTransitionChange,
}: ProjectionPanelProps) {
  const [fromCondition, setFromCondition] = useState<ProjectionCondition>(() =>
    defaultCondition(bundle),
  );
  const [toCondition, setToCondition] = useState<ProjectionCondition>(() =>
    defaultCondition(bundle, true),
  );
  const [decodedEndpoint, setDecodedEndpoint] = useState<'from' | 'to'>('to');
  const transition = useMemo(
    () => projectTransition(bundle, fromCondition, toCondition),
    [bundle, fromCondition, toCondition],
  );

  useEffect(() => {
    onTransitionChange(transition);
  }, [onTransitionChange, transition]);

  const decoded = transition[decodedEndpoint];
  const maximumComposition = decoded.composition[0]?.estimate.median ?? 1;

  return (
    <section
      className="panel projection-panel"
      aria-labelledby="projection-heading"
    >
      <div className="projection-heading">
        <div>
          <p className="eyebrow">Live from fitted parameters</p>
          <h2 id="projection-heading">Project a transition</h2>
          <p>
            Conditions are encoded into X; latent uncertainty is sampled from
            the bundle before the shared projection is applied. Geometry—not
            model confidence—sets the tier.
          </p>
        </div>
        <div className="transition-distance">
          <span>Transition distance</span>
          <strong>{formatNumber(transition.distance.median)}</strong>
          <small>
            95% {transition.distance.intervalType} interval{' '}
            {formatNumber(transition.distance.lower)}–
            {formatNumber(transition.distance.upper)}
          </small>
        </div>
      </div>

      <div className="projection-workspace">
        <div className="endpoint-grid">
          <ConditionEditor
            bundle={bundle}
            endpoint="from"
            condition={fromCondition}
            projection={transition.from}
            onChange={setFromCondition}
          />
          <div className="transition-arrow" aria-hidden="true">
            <span>→</span>
          </div>
          <ConditionEditor
            bundle={bundle}
            endpoint="to"
            condition={toCondition}
            projection={transition.to}
            onChange={setToCondition}
          />
        </div>

        <aside
          className="composition-decoder"
          aria-labelledby="decoder-heading"
        >
          <div className="decoder-heading-row">
            <div>
              <p className="eyebrow">Point → composition</p>
              <h3 id="decoder-heading">Decode the projected point</h3>
            </div>
            <div className="decoder-toggle" aria-label="Point to decode">
              {(['from', 'to'] as const).map((endpoint) => (
                <button
                  key={endpoint}
                  type="button"
                  className={decodedEndpoint === endpoint ? 'active' : ''}
                  onClick={() => setDecodedEndpoint(endpoint)}
                >
                  {endpoint}
                </button>
              ))}
            </div>
          </div>
          <p className="decoder-note">
            Approximate relative composition reconstructed from the two shared
            axes. Bars show the median; labels retain the 95% interval.
          </p>
          <div className="composition-list">
            {decoded.composition.slice(0, 8).map((feature) => (
              <div className="composition-row" key={feature.feature}>
                <div>
                  <strong>{feature.feature}</strong>
                  <span>
                    {formatValue(feature.estimate.median, 'proportion')}{' '}
                    <small>
                      {formatValue(feature.estimate.lower, 'proportion')}–
                      {formatValue(feature.estimate.upper, 'proportion')}
                    </small>
                  </span>
                </div>
                <span className="composition-track">
                  <i
                    style={{
                      width: `${(feature.estimate.median / maximumComposition) * 100}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <footer>
            <span className={`tier-badge tier-${decoded.tier}`}>
              {decoded.tier}
            </span>
            <span>
              {decoded.coverage
                ? `${decoded.group.replaceAll('_', ' ')} coverage ${formatValue(decoded.coverage.median, 'proportion')}`
                : `${decoded.group.replaceAll('_', ' ')} coverage unavailable`}
            </span>
          </footer>
        </aside>
      </div>
    </section>
  );
}
