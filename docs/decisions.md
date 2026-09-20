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
- gllvm standard errors seed a diagonal sampling-covariance approximation in M2;
  M3 adds resampling-based metric uncertainty.
- `TMB::openmp()` applies `cpuThreads`; affinity and hard memory enforcement
  stay runner-owned.

## Deferred until M3

- Bootstrap versus sampling-around-the-estimate for metric intervals.
- Full interpolated/extrapolated predictive clouds and geometric tier tests.
