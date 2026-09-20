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

The bundle is intentionally marked as a contract fixture rather than a fitted
scientific result. M2 will replace this illustrative parameterization in smoke
tests with output produced by the R backend.

Regenerate all files deterministically from the repository root:

```sh
pnpm generate:fixtures
```
