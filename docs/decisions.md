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
