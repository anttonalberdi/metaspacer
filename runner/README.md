# Runner

Electron owns job lifecycle, resource scheduling, telemetry, cancellation, and
portable-job export. The R package remains unaware of process management.

Local and exported jobs both invoke `run-spec.R`, whose only operation is the
public package entry point:

```sh
Rscript --vanilla run-spec.R model-spec.json . out
```

The desktop app sets the OpenMP and BLAS thread environment from the model spec,
queues jobs against a single global CPU-thread budget, and samples CPU and RSS
with `pidusage`. Crossing a soft memory limit is reported; crossing an optional
hard limit terminates the process by monitoring. This is a guardrail, not the
OS-level cgroup/Job Object enforcement deferred in the project brief.

An exported job directory includes the spec, exact input bytes, SHA-256
manifest, this launcher, a `renv.lock`, the metaspacer package source, and
cross-platform shell launchers.
