args <- commandArgs(trailingOnly = TRUE)
out_path <- if (length(args) >= 1L) args[[1L]] else tempfile("metaspacer-m2-smoke-")

bundle_path <- metaspacer::run_spec(
  spec_path = "examples/model-spec.json",
  data_dir = "examples",
  out_path = out_path
)
cat(bundle_path, "\n")
