import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { ResultsBundle } from '../shared/results-bundle';
import {
  BundleValidationError,
  fileName,
  getExampleBundle,
  parseResultsBundle,
  tierCounts,
} from './bundle';
import { CoveragePanel } from './components/CoveragePanel';
import { DesignBuilder } from './components/DesignBuilder';
import { ProjectionPanel } from './components/ProjectionPanel';
import { SpacePlot } from './components/SpacePlot';
import { StatsTable } from './components/StatsTable';
import { TierGuide } from './components/TierGuide';
import type { ProjectionTransition } from './projection';

interface LoadedBundle {
  data: ResultsBundle;
  source: string;
}

export function App() {
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [transition, setTransition] = useState<ProjectionTransition | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const useContent = (content: string, source: string) => {
    try {
      setLoaded({ data: parseResultsBundle(content), source });
      setTransition(null);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof BundleValidationError
          ? reason.message
          : 'The results bundle could not be opened.',
      );
    }
  };

  const openBundle = async () => {
    if (!window.metaspacer) {
      fileInput.current?.click();
      return;
    }

    try {
      const selection = await window.metaspacer.openBundle();
      if (selection) {
        useContent(selection.content, fileName(selection.path));
      }
    } catch {
      setError('The selected file could not be read.');
    }
  };

  const readFile = async (file: File) => {
    try {
      useContent(await file.text(), file.name);
    } catch {
      setError('The selected file could not be read.');
    }
  };

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) void readFile(file);
    event.currentTarget.value = '';
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  const showExample = () => {
    setLoaded({ data: getExampleBundle(), source: 'Golden example bundle' });
    setTransition(null);
    setError(null);
  };

  const hiddenInput = (
    <input
      ref={fileInput}
      className="visually-hidden"
      type="file"
      accept="application/json,.json"
      onChange={onFileSelected}
      aria-label="Select a results bundle"
    />
  );

  if (showBuilder) {
    return <DesignBuilder onClose={() => setShowBuilder(false)} />;
  }

  if (!loaded) {
    return (
      <main
        className={`welcome ${isDragging ? 'is-dragging' : ''}`}
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        {hiddenInput}
        <div className="welcome-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <section className="welcome-copy" aria-labelledby="welcome-title">
          <p className="brand">
            <span>meta</span>spacer
          </p>
          <div className="milestone-label">M7 · Interactive projection</div>
          <h1 id="welcome-title">
            Design the space.
            <br />
            Keep evidence visible.
          </h1>
          <p className="welcome-intro">
            Map microbiome inputs into a validated model recipe, run it with
            live resource telemetry, export it for remote compute, inspect a
            finished bundle, and project transitions directly from its fitted
            parameters.
          </p>
          <div className="welcome-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => setShowBuilder(true)}
            >
              <span>Design a model</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
            <div className="welcome-secondary-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => void openBundle()}
              >
                Open results bundle
              </button>
              <button
                className="quiet-button"
                type="button"
                onClick={showExample}
              >
                Golden example
              </button>
            </div>
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <p className="drop-hint">
            or drop a v1.0.0 results bundle anywhere in this window
          </p>
        </section>
        <aside className="welcome-tiers" aria-label="Confidence tiers">
          <div>
            <span className="tier-dot tier-measured" />
            <strong>Measured</strong>
            <small>the data itself</small>
          </div>
          <div>
            <span className="tier-dot tier-interpolated" />
            <strong>Interpolated</strong>
            <small>inside sampled conditions</small>
          </div>
          <div>
            <span className="tier-dot tier-extrapolated" />
            <strong>Extrapolated</strong>
            <small>outside the sampled domain</small>
          </div>
        </aside>
        <footer className="welcome-footer">
          <span>Local-first scientific software</span>
          <span>Your bundle stays on this machine</span>
        </footer>
      </main>
    );
  }

  const bundle = loaded.data;
  const counts = tierCounts(bundle);

  return (
    <div
      className={`app-shell ${isDragging ? 'is-dragging' : ''}`}
      onDragEnter={() => setIsDragging(true)}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {hiddenInput}
      <header className="topbar">
        <a
          className="wordmark"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setLoaded(null);
          }}
        >
          <span>meta</span>spacer
        </a>
        <div className="bundle-source">
          <span className="status-dot" />
          <div>
            <small>Results bundle</small>
            <strong>{loaded.source}</strong>
          </div>
        </div>
        <button
          className="outline-button"
          type="button"
          onClick={() => void openBundle()}
        >
          Open another
        </button>
      </header>

      <main className="dashboard">
        {error ? (
          <p className="error-message dashboard-error" role="alert">
            {error}
          </p>
        ) : null}
        <section className="dashboard-intro" aria-labelledby="dashboard-title">
          <div>
            <p className="eyebrow">Results overview</p>
            <h1 id="dashboard-title">A map of possible community states</h1>
            <p>
              {bundle.precomputed.ordination.states.length} states ·{' '}
              {bundle.provenance.engine.name} {bundle.provenance.engine.version}{' '}
              · seed {bundle.provenance.seed}
            </p>
          </div>
          <dl className="state-summary">
            <div>
              <dt>Measured</dt>
              <dd>{counts.measured}</dd>
            </div>
            <div>
              <dt>Interpolated</dt>
              <dd>{counts.interpolated}</dd>
            </div>
            <div>
              <dt>Extrapolated</dt>
              <dd>{counts.extrapolated}</dd>
            </div>
          </dl>
        </section>

        <TierGuide />

        <div className="overview-grid">
          <SpacePlot bundle={bundle} transition={transition} />
          <div className="side-column">
            <CoveragePanel bundle={bundle} />
            <section
              className="provenance-card"
              aria-labelledby="boundary-heading"
            >
              <p className="eyebrow">Geometric boundary</p>
              <h2 id="boundary-heading">
                {bundle.provenance.extrapolationMethod.name.replaceAll(
                  '_',
                  ' ',
                )}
              </h2>
              <p>
                Conditions:{' '}
                {bundle.provenance.extrapolationMethod.conditionColumns.join(
                  ', ',
                )}
                . Predictions beyond this boundary remain explicitly flagged.
              </p>
              <div className="provenance-meta">
                <span>Bundle {bundle.bundleVersion}</span>
                <span>metaspacer {bundle.provenance.metaspacerVersion}</span>
              </div>
            </section>
          </div>
        </div>

        <ProjectionPanel
          key={bundle.provenance.specSha256}
          bundle={bundle}
          onTransitionChange={setTransition}
        />

        {bundle.provenance.warnings?.length ? (
          <aside className="warning-strip" aria-label="Bundle warnings">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Read with context</strong>
              {bundle.provenance.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </aside>
        ) : null}

        <StatsTable bundle={bundle} />
        <footer className="dashboard-footer">
          <span>
            Created {new Date(bundle.provenance.createdAt).toLocaleString()}
          </span>
          <span>Spec {bundle.provenance.specSha256.slice(0, 12)}…</span>
        </footer>
      </main>
    </div>
  );
}
