# Architecture

metaspacer has four components joined by two versioned contracts:

```text
design builder -> model spec -> R package -> results bundle -> consumer
                                  ^   |
                                  |   v
                                  runner
```

The design builder and consumer live in `app/`. The pure R package lives in
`rpkg/`. Local and exported execution will share one headless R entry point;
process lifecycle belongs to `runner/` and the Electron main process, never to
the R package.

## Invariants

1. Every metric and prediction is tagged `measured`, `interpolated`, or
   `extrapolated`.
2. Every quantitative result includes a median and interval.
3. Extrapolation is classified geometrically against the sampled condition
   space, independently of the statistical engine.
4. Technical genome fields are not ecological traits unless a user explicitly
   opts into a dual role.
5. Local and exported jobs call the same R entry point.
6. JSON Schemas in `schemas/` define all cross-component data shapes.

## Contract versioning

Both initial contracts use version `1.0.0` and JSON Schema draft 2020-12. Patch
changes may clarify descriptions or relax constraints. Additive compatible
fields require a minor version; breaking shape or semantic changes require a
major version. Consumers must reject unsupported major versions.

The schemas enforce document structure. `tests/contracts.test.mjs` also checks
relationships JSON Schema cannot express cleanly, including fixture hashes,
table identifiers, matrix dimensions, tier definitions, and uncertainty
presence.

## R package engine boundary

`metaspacer::run_spec()` is the package's only exported function. It selects an
internal S3 engine and invokes the same five-stage contract for every backend:
`validate`, `estimate_cost`, `translate`, `fit`, and `extract`. Validation
returns machine-readable issue codes, JSON-pointer-like paths, human-readable
messages, and mismatch details.

The gllvm translation uses its public API and accessors. In particular,
`getLV()` and `getLoadings()` provide the correctly scaled latent terms; the
consumer-facing coefficient matrix is reconstructed from level-zero link-scale
predictions. This avoids coupling the bundle format to gllvm's normalized
internal parameter representation.

Bundle files are written atomically. CPU thread configuration is passed to TMB,
while process affinity, hard memory limits, scheduling, and termination remain
outside the pure package.

## Metric extraction and tiers

Measured metrics are computed from observed counts and their shared ordination,
with uncertainty from within-group bootstrap resampling. Model-derived metrics
and predicted states use asymptotic fixed-effect and loading draws plus the
fitted latent distribution. The spec seed makes both paths reproducible without
changing the caller's random-number stream.

Condition tiers are geometric rather than model-dependent. Discrete focal
variables define sampled strata; continuous variables are checked against an
observed range, a two-dimensional convex hull, or standardized ranges in higher
dimensions. Predicted states inside that domain are `interpolated`; states
outside it are `extrapolated` and retain their distance-to-domain flag.

## Consumer boundary

The renderer receives bundle text from either a sandboxed Electron preload
bridge or a browser file input. It validates the document against the results
bundle schema before rendering and keeps filesystem access out of the renderer.
The density field uses predicted ordination states; measured samples are drawn
as solid points, interpolation as outlined diamonds, and extrapolation as
crosses. Coverage and statistics use only precomputed metrics from the bundle,
so the M4 consumer performs no model fitting or metric recomputation.

Interactive projection stays inside the renderer and reads only the fitted
parameter layer of a validated bundle. Design columns are reconstructed from
their declarative predictor/factor metadata, then the renderer evaluates
`L = X · Beta + Eta · Lambda`, applies the stored shared rotation, and uses the
log-link inverse to decode relative composition. It samples either the stored
parameter covariance or posterior draws together with the fitted latent
distribution, so coordinates, transition distance, and decoded composition
retain intervals.

The projection workbench repeats the R extractor's engine-independent
`mixed_hull_range` rule over the observed conditions carried by the bundle.
Categorical and binary predictors define strata; continuous predictors use a
range, two-dimensional hull, or higher-dimensional standardized box. That
geometric result alone determines interpolation versus extrapolation. The
corresponding measured Chao coverage is displayed when the bundle reports it for
the selected group; missing group coverage is stated rather than inferred.

## Design-builder boundary

The renderer reads dropped CSV/TSV tables and an optional Newick tree only to
discover columns and propose reversible role defaults. It produces a model spec
directly from the versioned schema and hashes the exact input bytes.
Browser-side schema validation catches incomplete drafts, but it is not accepted
as a scientific preflight.

For a complete draft, the sandboxed preload bridge sends the spec and input
bytes to Electron's main process. Main writes them to a short-lived staging
directory and invokes the package's internal `preflight_spec()` function. That
function composes the same document, hash, data, and engine validation used by
`run_spec()` and only estimates cost after validation succeeds. Staging is
removed after each check; no fitting occurs. The gate then requires an explicit
local-or-export choice before execution or packaging.

## Runner boundary

Electron's main process owns one global local-job manager. Jobs reserve their
requested thread count against an application-wide budget before `Rscript`
starts; jobs that do not fit wait in one queue. The main process stages exact
input bytes in a private temporary directory, passes thread and optional
affinity settings through OpenMP/BLAS environment variables, and invokes the
shared `run-spec.R` launcher. `pidusage` samples process CPU and RSS for the
renderer. A soft-limit crossing is visible telemetry; an optional hard-limit
crossing stops the process through monitoring. OS-level memory enforcement
remains a later milestone as specified in the project brief.

Export uses the same staged inputs and R launcher. A portable job directory
contains the spec, data, SHA-256 manifest, `renv.lock`, the metaspacer package
source, and POSIX/Windows launchers. It can therefore recreate the fitted
environment remotely without introducing a second execution path. Job lifecycle
and packaging do not enter the R package.
