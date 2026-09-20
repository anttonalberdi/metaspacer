# Golden example

This fixture represents 50 wild animals, 25 animals from Zoo A, and 25 from Zoo
B. The response table has 40 simulated MAG count columns. Sample metadata
contains the focal variables `group` and `habitat_score`; feature metadata keeps
functional traits separate from technical QC fields; the Newick tree preserves
feature-table order.

- `model-spec.json` is a complete gllvm-oriented model recipe.
- `results-bundle.json` demonstrates every required metric, confidence tier,
  projection parameter, and provenance field.
- `data/` contains the referenced, SHA-256-pinned inputs.

The committed bundle remains a deterministic contract fixture rather than a
fitted scientific result. M2 smoke tests fit this dataset into a temporary
output directory and validate the generated bundle without replacing the stable
fixture.

Regenerate all files deterministically from the repository root:

```sh
pnpm generate:fixtures
```

Fit and validate it with the M2 backend after installing `rpkg/`:

```sh
Rscript scripts/smoke-r-backend.R out/m2-smoke
pnpm validate:bundle out/m2-smoke/results-bundle.json
```
