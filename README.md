# metaspacer

metaspacer is an open-source scientific tool for modelling, visualising, and
projecting host-associated microbiomes as **metagenomic spaces**. It keeps
observations, interpolation, and extrapolation visibly separate and attaches
uncertainty to every reported metric and prediction.

## Project status

Development has completed **M3 — tier-tagged metric extractor**. The repository
currently contains:

- versioned JSON Schemas for model specifications and results bundles;
- generated TypeScript types derived from those schemas;
- a deterministic captive/wild golden dataset and matching example documents;
- contract, fixture-integrity, formatting, lint, and R package checks;
- a pure R package with the single public `run_spec()` entry point;
- structured validation and cost estimation through an internal engine
  interface; and
- a CPU gllvm backend for negative-binomial/ZINB fits, offsets, fourth-corner
  traits, phylogenetic random effects, uncertainty extraction, and conforming
  bundle output;
- deterministic bootstrap intervals for measured dispersion, effective
  dimensionality, coverage, overlap, and containment;
- asymptotic sampling intervals for transition, plasticity, and the actionable
  vs structural variance split; and
- observed, interpolated, and extrapolated ordination states classified by a
  geometric mixed hull/range test.

The desktop UI and runner do not exist yet. M4 adds the first bundle consumer.

## Repository map

```text
schemas/          Versioned source-of-truth contracts
examples/         Golden dataset, model spec, and results bundle
app/src/shared/   Types generated from the contracts
rpkg/             Pure R package and gllvm engine
runner/           Reserved for local/export execution packaging
docs/             Architecture and decisions
scripts/          Deterministic fixture/type generators
tests/            Cross-contract and fixture-integrity tests
```

## Development

Requirements: Node.js 24, pnpm 11, R 4.3 or newer, and the dependencies listed
in `rpkg/DESCRIPTION`.

```sh
pnpm install --frozen-lockfile
pnpm generate
pnpm check
R CMD check rpkg --no-manual
```

`pnpm generate` is deterministic. It regenerates the golden CSV/Newick files,
updates their SHA-256 hashes in the example spec and provenance, and regenerates
TypeScript declarations from the schemas.

Install the R package and fit the golden example headlessly:

```sh
R CMD INSTALL rpkg
Rscript -e "metaspacer::run_spec('examples/model-spec.json', 'examples', 'out/golden')"
pnpm validate:bundle out/golden/results-bundle.json
```

The same `run_spec()` call is used by local and exported runners. The package
does not spawn or manage processes.

See [PROJECT_BRIEF.md](PROJECT_BRIEF.md) for the full product brief,
[docs/architecture.md](docs/architecture.md) for boundaries and invariants, and
[docs/decisions.md](docs/decisions.md) for accepted and deferred choices.

metaspacer is available under the [MIT License](LICENSE).
