# Decisions

## Provisional, reversible defaults

- JavaScript package manager: pnpm workspace.
- Desktop stack: Electron + React + TypeScript, to be scaffolded after M1.
- R package setup: conventional package layout, `testthat`, `lintr`, and `air`.
- Contract dialect: JSON Schema draft 2020-12.
- Contract versions: semantic versions beginning at `1.0.0`.
- Open-source license: MIT.

## M2 verified choices

- Minimum R version: 4.3.0.
- First engine: gllvm >= 2.0.0, probed with gllvm 2.0.2 on R 4.3.3.
- Negative-binomial family maps to `negative.binomial`; ZINB maps to `ZINB`.
- Library size is a log effort offset centered on median library size.
- gllvm standard errors seed a diagonal sampling-covariance approximation in M2.
- `TMB::openmp()` applies `cpuThreads`; affinity and hard memory enforcement
  stay runner-owned.

## M3 verified choices

- Measured metrics use 200 deterministic, within-group nonparametric bootstrap
  draws. Model-derived metrics use 200 deterministic asymptotic draws from the
  fitted fixed-effect covariance and delta-method latent-loading variances.
- Simple fixed-effect fits use the covariance returned by `vcov.gllvm` after
  reordering it to the bundle's coefficient-major layout. Derived coefficients
  from fourth-corner or phylogenetic random effects use a documented diagonal
  standard-error fallback when no exact mapping is available.
- Predicted clouds evaluate `X · Beta + Eta · Lambda`, sample the fitted latent
  distribution, and apply the shared projection.
- The geometric `mixed_hull_range` test first matches categorical/binary strata,
  then uses an observed interval for one continuous variable, a convex hull for
  two, and standardized observed ranges for higher dimensions.
- Variance partitioning reports fixed focal effects as actionable and latent
  structure as structural, normalized to a two-component split.

## M4 verified choices

- The consumer is a Vite-built React renderer hosted by a security-hardened
  Electron window (`contextIsolation`, sandbox, and no Node integration).
- Bundle loading crosses a narrow preload bridge that returns file text; the
  renderer validates it against the versioned JSON Schema before use.
- The space view uses a lightweight canvas density layer plus an accessible SVG
  point layer. It does not add a charting dependency.
- Predicted states drive density fields, while marks distinguish measured,
  interpolated, and extrapolated states. The same tiers remain explicit in the
  statistics table.
- The golden contract fixture is available from the empty state for a
  deterministic, no-fit demonstration.

## M5 verified choices

- Builder inputs remain role-specific: count table, sample metadata, feature
  metadata, and an optional Newick tree. CSV and TSV are supported by the
  current R backend; Parquet remains contract-reserved.
- The renderer derives column suggestions and validates the emitted spec against
  JSON Schema, while scientific validation remains package-owned.
- Electron stages exact input bytes in a temporary directory and invokes the
  internal package preflight. The preflight reuses document loading,
  hash-checking, engine validation, and `estimate_cost()` without fitting.
- Emitted specs use stable portable paths under `data/`. M5 requires the
  explicit route decision but does not itself execute it.
- The gate stays unavailable in a plain browser because substituting a partial
  TypeScript reimplementation would let package and builder validation drift.

## M6 verified choices

- The Electron main process owns a singleton job manager. Its global CPU budget
  defaults to Node's available parallelism and can be constrained with
  `METASPACER_CPU_BUDGET`; requested threads are reserved before a queued job
  starts.
- `OMP_NUM_THREADS`, OpenMP/BLAS companion variables, and optional affinity are
  derived from the model spec. Affinity is expressed through
  `GOMP_CPU_AFFINITY`, `OMP_PLACES`, and `OMP_PROC_BIND` without adding a shell
  execution path.
- `pidusage` supplies live process CPU and RSS. The soft memory limit warns; the
  optional hard limit terminates through monitoring. This is deliberately
  distinct from the cgroup/Job Object hard caps deferred by the brief.
- Local and exported jobs use the same minimal `run-spec.R` launcher and public
  `metaspacer::run_spec()` call. Export produces a directory containing exact
  inputs, hashes, launchers, package source, and a `renv.lock` snapshot rather
  than generating engine-specific code.

## M7 verified choices

- Interactive projection consumes only results-bundle fields; it does not call
  R, refit a model, or add a second engine-specific prediction path.
- Design rows are evaluated from the bundle's declarative columns, including
  categorical indicators, binary encodings, continuous standardization, and
  interaction products.
- Live uncertainty uses 200 deterministic draws. Sampling-covariance bundles use
  their diagonal or dense covariance, posterior bundles use their stored draws,
  and both sample the fitted latent distribution before applying the shared
  projection.
- Relative composition is a two-axis reconstruction through the stored center
  and rotation. It is labelled approximate because discarded axes cannot be
  recovered; the log-link offset cancels during relative normalization.
- The TypeScript geometric classifier mirrors the package rule against observed
  bundle states. Coverage is looked up from measured group metrics and is shown
  as unavailable when the bundle does not report the selected group, rather than
  substituting another population's value.
