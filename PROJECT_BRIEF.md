# metaspacer — Development Kickoff Prompt

> Paste this whole file as your opening instruction to an AI coding agent in VS
> Code (Copilot agent mode, Cline, Continue, etc.), or keep it in the repo as
> `PROJECT_BRIEF.md`. The agent should treat everything here as the source of
> truth for architecture and scope.

---

## 0. Your role and how to work

You are an AI development agent bootstrapping a new open-source scientific tool
called **metaspacer**. Work like a careful senior engineer starting a greenfield
project:

- **Build incrementally in small, reviewable commits.** Follow the milestone
  plan in §6. Do not scaffold everything at once.
- **Schemas are the source of truth.** Two serializable contracts (§4) define
  every seam. Generate code from them; never let two components disagree about a
  shape.
- **Verify library APIs; do not assume them.** `gllvm` ≥ 2.0 is recent and its
  arguments for negative-binomial families, offsets, fourth-corner traits, and
  _phylogenetic random effects_ are version-specific. Check `?gllvm`, the
  package vignettes, and installed version before writing calls. If unsure,
  write a tiny probe script and run it rather than guessing signatures.
- **Ask before irreversible choices** (build tooling, package manager, license)
  and **stop at the gates** marked in the milestones for human review.
- **Write tests as you go.** Every schema gets validation tests; every backend
  gets a fit-the-example smoke test.
- **Prefer clarity over cleverness.** This is research software other scientists
  will read and extend.

---

## 1. What metaspacer is

metaspacer operationalizes the **"metagenomic spaces" framework** (Alberdi et
al. 2025, _J. Evol. Biol._). The framework treats a host-associated microbiome
not as one fixed community but as a **space** of possible community states,
where:

- a **metagenomic state** = the genetic/functional configuration of a community
  at one time (one sample);
- a **potential metagenomic space (pMS)** = the spread of states under fixed
  conditions (its width = _oscillation_);
- a **fundamental metagenomic space (fMS)** = all states the host could exhibit
  within a generation, bounded by host genetics;
- **plasticity / resilience** = how the space moves and returns when conditions
  change.

metaspacer lets a researcher fit a **joint species distribution model** to
microbiome data, then **visualize** the space, **estimate how much of it has
been sampled**, and **predict/project** community states at chosen conditions —
while always separating what was **measured** from what was **interpolated**
from what was **extrapolated**.

The motivating use case is captive vs wild conservation microbiomes (e.g., 50
wild animals + 25 each from two zoos): quantify how far each captive population
has moved, how much of the wild space it still occupies, and whether that
transition is even well-sampled.

---

## 2. The intellectual spine — non-negotiable design invariants

Encode these everywhere; they are the reason the tool exists rather than being
another plotting layer.

1. **Three confidence tiers, never blurred.** Every metric and prediction
   carries a tier:
   - `measured` — computed on the data itself (observed space). Trustworthy
     regardless of model correctness.
   - `interpolated` — model prediction at conditions **inside** the sampled
     range (pMS / realised states). Uncertainty intervals meaningful.
   - `extrapolated` — prediction **beyond** sampled conditions (fMS _proxy_).
     Reported as a widening range with an explicit flag. Note: a model fit
     within one generation/population does **not** see the genetic ceiling that
     bounds the true fMS, so it is always a proxy.
2. **Every quantity ships with uncertainty.** Median + interval, from posterior
   draws (HMSC) or bootstrap / sampling-around-the-estimate (gllvm).
3. **The extrapolation flag is geometric, not statistical** — a hull/range test
   on conditions. It survives whatever engine produced the fit.
4. **Function-over-taxonomy is the tractability lever.** Fitting scales with the
   number of response variables. Dozens–hundreds of MAGs/functions run on a
   laptop in minutes–hours; thousands of sparse ASVs plus phylogeny plus traits
   is what makes it crawl. Default guidance and cost warnings must reflect this.
5. **Local and remote runs are one code path** parametrized by _where_ they run.
   Never build "run locally" and "export to run elsewhere" as two
   implementations — they drift.
6. **The R package stays pure.** It validates, fits, extracts, returns a bundle.
   It knows nothing about who invoked it or process lifecycle.
   Scheduling/monitoring/killing jobs is the app's job.

---

## 3. Architecture — four components

```
 ┌────────────────┐   model spec    ┌──────────────────┐   results bundle  ┌────────────────┐
 │ 1. DESIGN      │ ──────────────▶ │ 2. metaspacer    │ ───────────────▶  │ 4. CONSUMER    │
 │    BUILDER     │   (JSON, not     │    R PACKAGE     │   (JSON + data)   │  (visualise,   │
 │ (Electron/RN)  │    code)         │  (the bridge)    │                   │   stats,       │
 └────────────────┘                  └──────────────────┘                   │   projection)  │
        │                              ▲            │                        └────────────────┘
        │ validate + cost estimate     │ headless   │ run via
        ▼ (calls R pkg pre-flight)     │ Rscript    ▼
 ┌────────────────┐                    │      ┌──────────────────┐
 │  VALIDATE &    │────────────────────┘      │ 3. RUNNER        │
 │  ESTIMATE GATE │                            │ local child proc │
 │ (run here or   │                            │  OR exported     │
 │  export?)      │                            │  container job   │
 └────────────────┘                            └──────────────────┘
```

**1. Design builder** (Electron desktop app; React + TypeScript). User
drag-drops four input tables onto a canvas and maps their roles. Produces a
**model spec** (declarative JSON, never code). Runs **live validation** (ID
matching across tables) and a **cost pre-flight estimate** as objects are
dropped.

**2. metaspacer R package** (the bridge — see §5). Single headless entry point
`run_spec()`. Internally: an **engine abstraction** with
`validate → translate → fit → extract`. First backend: **gllvm** (CPU). Later
backends (HMSC, HMSC-HPC/GPU, a conditional VAE) implement the same interface
and emit the same bundle schema.

**3. Runner.** Either an Electron-spawned child `Rscript` process on this
machine, or an **exported self-contained job** (spec + data/hashes + environment
lock, ideally a container recipe) to run on HPC and return the bundle. Same
execution entry point in both cases.

**4. Consumer** (in the Electron app). Reads a **results bundle** and provides:
the space visualization (density + coverage), tier-tagged statistics, and
**interactive projection** (predict at new conditions, decode a point back to a
composition, draw a captive→wild transition) computed **live in-app** from the
fitted parameters.

---

## 4. The two contracts (build these FIRST)

Define both as versioned **JSON Schema** in `/schemas`. They are the spine; the
builder, package, runner, and consumer are all just producers or readers of
these two files.

### 4a. Model spec (`model-spec.schema.json`)

A declarative recipe. Includes at minimum:

- `specVersion`
- `data`: references (paths/hashes) to the four inputs — count table, sample
  metadata, genome/feature metadata, phylogenetic tree (tree optional).
- `roles`: which table is the response; which metadata columns are **focal
  variables** (fixed effects); which genome columns are **functional traits**
  (fourth corner) vs **technical QC** (completeness, contamination, genome size)
  — the latter used for filtering/offset, **not** as ecological traits.
- `model`: family (e.g. `negative_binomial`, `zinb`), offset spec (library size,
  optionally refined by genome size/completeness), number of latent variables,
  whether to use the tree (phylogenetic random effects), fourth-corner formula.
- `engine`: `gllvm` | `hmsc` | `hmsc_hpc` | `vae`.
- `resources`:
  `{ cpuThreads, cpuAffinity?, gpuDevice?, gpuMemoryLimit?, memorySoftLimitMB, memoryHardLimit? }`
  — plumbed through the package to the engine setters. GPU fields meaningful
  only for GPU engines.
- `seed`, `output` path.

### 4b. Results bundle (`results-bundle.schema.json`)

The only thing the consumer reads. **Two layers plus provenance:**

- **Precomputed results** (render instantly): tier-tagged metrics
  (dispersion/oscillation, effective dimensionality, Schoener's D overlap,
  containment, transition distance, plasticity, variance partition split into
  actionable vs structural, Chao sample coverage), and ordinated predicted
  states per condition for drawing the space.
- **Fitted parameters** (for live projection): coefficients (`Beta`), latent
  loadings (`Lambda`/`theta`), the shared projection (rotation + center),
  link/family metadata, and either posterior draws (HMSC) or estimate + sampling
  covariance (gllvm) — enough to run `L = X·Beta + Eta·Lambda` on-device.
- **Provenance**: spec hash, data hashes, engine + version, seed, timestamp,
  tier definitions.

---

## 5. The metaspacer R package (component 2)

- **Public surface: one function**, `run_spec(spec_path, data_dir, out_path)`,
  callable headlessly:
  `Rscript -e "metaspacer::run_spec('spec.json','data/','out/')"` — identical
  whether spawned locally by Electron or invoked by an HPC batch script after
  `module load R`. This must not require an interactive session.
- **Internal engine interface** (one S3/R6 contract, implemented per engine):
  - `validate(spec, data)` — ID matching (count-table sample IDs ↔ metadata
    rows; tree tips ↔ genome/MAG IDs; focal vars present; family appropriate).
    Returns structured, specific errors ("312/340 MAGs matched the tree; 28
    unmatched"). **This same function backs the builder's pre-flight**, so
    validation lives in one place.
  - `estimate_cost(spec, data)` — rough runtime/memory from rows × species ×
    latent factors × engine; feeds the run-here-or-export gate. Cheap; no
    fitting.
  - `translate(spec, data)` — build the concrete engine call. For gllvm:
    family + offset + focal-variable `formula` + fourth-corner trait terms +
    phylogenetic correlation matrix (from the tree via `ape::vcv` /
    `cophenetic`) + resource setters (`TMB::openmp(cpuThreads)`).
  - `fit(...)` — run the fit.
  - `extract(fit)` — normalize the fitted object into the **results bundle**
    schema. This is where the tier-tagged metric computations live (dispersion,
    overlap, containment, plasticity, variance partition, coverage, effective
    dimensionality) plus the trimmed parameters for on-device prediction.
- **First backend: gllvm (CPU-only).** Negative-binomial (or ZINB) response,
  library-size offset, focal-variable fixed effects, optional fourth-corner
  traits, optional phylogenetic random effects. Uncertainty via bootstrap or
  sampling around the MLE (using the fitted covariance/Hessian) — since gllvm is
  frequentist/VA, the tiers read "confidence interval," not "credible interval."
- **Dependencies:** `gllvm` (≥ 2.0), `ape`, `jsonlite`. Keep it lean.
- **Purity:** no process spawning, no scheduling, no telemetry inside the
  package.

A reference metric implementation already exists (the
`metagenomic_space_metrics.R` logic: predictive-cloud generation from
`X·Beta + Eta·Lambda`, tier tagging, Chao coverage, Schoener's D, Mahalanobis
containment, participation-ratio effective dimensionality, variance-partition
split, bundle export). Fold that in as the `extract` back-half, adapting its
accessors from Hmsc's posterior list to gllvm's fitted object.

---

## 6. Build plan (milestones — follow in order, stop at gates)

- **M0 — Scaffold.** Monorepo layout (§7), license, README, CI stub,
  formatter/linter for both TS and R. Commit. **No feature code yet.**
- **M1 — Contracts + golden example.** Write both JSON Schemas (§4). Generate a
  small **example dataset**: simulated 50 wild + 25 Zoo A + 25 Zoo B, as a count
  table (~40 functions), sample metadata (group), genome metadata (taxonomy + a
  couple of traits + QC columns), and a tiny tree. Produce a hand-written
  **example spec** and a **hand-written example bundle** that both validate.
  **GATE: show the schemas and example spec/bundle for review before M2.**
- **M2 — R package skeleton + gllvm backend.** `run_spec()` headless; the
  `validate/estimate_cost/translate/fit/extract` interface; a gllvm backend that
  fits the example dataset (CPU, NB + offset + group fixed effects) and writes a
  bundle that conforms to the schema. Smoke test: `run_spec` on the example
  produces a valid bundle.
- **M3 — Tier-tagged metric extractor.** Fold the metric logic into `extract`:
  coverage, dispersion/oscillation, overlap, containment, transition,
  plasticity, variance-partition, effective dimensionality — each with tier +
  interval. Test tiers flip correctly when a condition is inside vs outside the
  covariate range.
- **M4 — Minimal consumer.** Electron+React screen that loads a bundle and
  renders: the space (density field + sampled points), the coverage panel, and
  the tier-tagged stats table. No builder yet — load a bundle file directly.
- **M5 — Design builder.** Drag-drop the four tables, map roles, live validation
  (calls the R package's `validate`), cost estimate (calls `estimate_cost`), and
  emit a spec. Add the explicit **validate-and-estimate gate** ("run here or
  export?").
- **M6 — Runner.** Local: Electron spawns `Rscript` with the resource profile as
  env vars (`OMP_NUM_THREADS`, affinity, memory guardrail via monitoring).
  Export: package spec+data+env-lock as a self-contained job. Same entry point
  both ways. Add a simple global concurrency budget + live CPU/RSS telemetry
  (`pidusage`).
- **M7 — Interactive projection.** In-app `L = X·Beta + Eta·Lambda` from the
  bundle's fitted params: predict at new conditions, decode a point →
  composition, draw a transition path — each shown next to its
  coverage/extrapolation flag.

Later (behind the same interface, only when asked): HMSC and HMSC-HPC (GPU)
backends, a conditional-VAE backend, hard OS-level memory caps (cgroups / Job
Objects), GPU device/VRAM controls (grey out for CPU-only gllvm).

---

## 7. Suggested repo layout

```
metaspacer/
├─ PROJECT_BRIEF.md            # this file
├─ schemas/                    # JSON Schema — the two contracts (source of truth)
│  ├─ model-spec.schema.json
│  └─ results-bundle.schema.json
├─ examples/                   # golden example: simulated captive/wild dataset + spec + bundle
├─ rpkg/                       # the metaspacer R package (component 2)
│  ├─ DESCRIPTION  NAMESPACE
│  ├─ R/           # run_spec, engine interface, gllvm backend, extractors/metrics
│  └─ tests/
├─ app/                        # Electron + React/TS: builder (1) + consumer (4)
│  ├─ src/main/                # electron main; job-runner (component 3, local)
│  ├─ src/renderer/            # builder, consumer, projection UI
│  └─ src/shared/              # generated TS types from schemas; linear-predictor math
├─ runner/                     # export packaging (container recipe / env lock)
└─ docs/
```

Generate the TypeScript types in `app/src/shared` from the JSON Schemas so the
app and package can never disagree on shapes.

---

## 8. Domain reference the agent should encode

**Four input tables → gllvm roles:**

- **Count table (ASVs/MAGs)** → response matrix; NB/ZINB family + **library-size
  offset** (handles compositionality by modelling counts with an effort offset,
  not CLR).
- **Sample metadata (focal variables)** → fixed effects (condition space; the
  `Beta` coefficients). May also inform constrained/concurrent ordination so the
  space axes are meaningful.
- **Genome metadata** → split roles: taxonomy + **functional traits** go into
  the **fourth-corner** model (traits modulate environmental responses);
  **completeness, contamination, genome size** are **technical**, used as a QC
  filter and to refine the offset (genome size also governs coverage→abundance),
  **not** as ecological traits — though genome size may optionally double as a
  real trait if the user chooses.
- **Phylogenetic tree** → **phylogenetic random effects** (gllvm ≥ 2.0), via a
  correlation matrix from `ape::vcv` and cophenetic distances. Note the NNGP
  approximation is sensitive to species ordering (keep tip-label order); it adds
  compute.

**Key equation** (used both to generate predictive clouds in `extract` and for
on-device projection in the consumer): `L = X · Beta + Σ_r (Eta_r · Lambda_r)`,
then apply the inverse link per response.

---

## 9. First actions for this session

1. Confirm build tooling choices with the human (package manager, Electron
   scaffolder, R build setup, license) — one short question, then proceed.
2. Do **M0** (scaffold) and **M1** (schemas + golden example dataset + example
   spec/bundle).
3. **Stop at the M1 gate** and present: the two JSON Schemas, the example spec,
   and the example bundle, for review — before touching the R package.

Do not attempt M2+ until the schemas are approved. When in doubt about a `gllvm`
signature, run a probe rather than guessing.
