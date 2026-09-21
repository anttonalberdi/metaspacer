args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) {
  stop("Usage: Rscript --vanilla run-spec.R <spec> <data-dir> <output>")
}
written <- metaspacer::run_spec(args[[1]], args[[2]], args[[3]])
cat(normalizePath(written, mustWork = FALSE), "\n")
