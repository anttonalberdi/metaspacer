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
