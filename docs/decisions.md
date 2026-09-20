# Decisions

## Provisional, reversible defaults

- JavaScript package manager: pnpm workspace.
- Desktop stack: Electron + React + TypeScript, to be scaffolded after M1.
- R package setup: conventional package layout, `testthat`, `lintr`, and `air`.
- Contract dialect: JSON Schema draft 2020-12.
- Contract versions: semantic versions beginning at `1.0.0`.

## Owner decision required

- **Open-source license.** No license has been selected. MIT, Apache-2.0, and
  GPL-3.0-or-later have materially different patent and copyleft terms, so this
  decision is not inferred by the scaffold.

## Deferred until M2

- Exact minimum R version and dependency versions.
- `gllvm` API translation details, after probing the installed current version.
- Bootstrap versus sampling-covariance uncertainty as the initial default.
