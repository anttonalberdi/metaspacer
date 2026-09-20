# metaspacer

metaspacer is an open-source scientific tool for modelling, visualising, and
projecting host-associated microbiomes as **metagenomic spaces**. It keeps
observations, interpolation, and extrapolation visibly separate and attaches
uncertainty to every reported metric and prediction.

## Project status

Development is at the **M1 contracts gate**. The repository currently contains:

- versioned JSON Schemas for model specifications and results bundles;
- generated TypeScript types derived from those schemas;
- a deterministic captive/wild golden dataset and matching example documents;
- contract, fixture-integrity, formatting, and lint checks; and
- empty component boundaries for the R package, desktop app, and runner.

The statistical backend and UI deliberately do not exist yet. The schemas and
golden fixtures should be reviewed before M2 starts.

The open-source license is also intentionally pending owner selection. Until a
license is added, copyright law reserves all rights; do not redistribute this
repository as though an open-source license already applied.

## Repository map

```text
schemas/          Versioned source-of-truth contracts
examples/         Golden dataset, model spec, and results bundle
app/src/shared/   Types generated from the contracts
rpkg/             Reserved for the pure R package
runner/           Reserved for local/export execution packaging
docs/             Architecture and decisions
scripts/          Deterministic fixture/type generators
tests/            Cross-contract and fixture-integrity tests
```

## Development

Requirements: Node.js 24, pnpm 11, R 4.3 or newer, and the R package `lintr`.

```sh
pnpm install --frozen-lockfile
pnpm generate
pnpm check
```

`pnpm generate` is deterministic. It regenerates the golden CSV/Newick files,
updates their SHA-256 hashes in the example spec and provenance, and regenerates
TypeScript declarations from the schemas.

See [PROJECT_BRIEF.md](PROJECT_BRIEF.md) for the full product brief,
[docs/architecture.md](docs/architecture.md) for boundaries and invariants, and
[docs/decisions.md](docs/decisions.md) for the choices still awaiting owner
confirmation.
