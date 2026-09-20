# Architecture

metaspacer has four components joined by two versioned contracts:

```text
design builder -> model spec -> R package -> results bundle -> consumer
                                  ^   |
                                  |   v
                                  runner
```

The design builder and consumer will live in `app/`. The pure R package will
live in `rpkg/`. Local and exported execution will share one headless R entry
point; process lifecycle belongs to `runner/` and the Electron main process,
never to the R package.

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
