set.seed(20250920)

output_dir <- file.path("examples", "data")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

n_samples <- 100L
n_features <- 40L

sample_ids <- sprintf("S%03d", seq_len(n_samples))
feature_ids <- sprintf("MAG_%03d", seq_len(n_features))
groups <- c(rep("Wild", 50L), rep("Zoo_A", 25L), rep("Zoo_B", 25L))

group_shift <- c(Wild = 0, Zoo_A = -0.25, Zoo_B = 0.2)
habitat_score <- pmax(
  -1,
  pmin(1, rnorm(n_samples, mean = unname(group_shift[groups]), sd = 0.28))
)
library_size <- round(rlnorm(n_samples, meanlog = log(16000), sdlog = 0.22))

sample_metadata <- data.frame(
  sample_id = sample_ids,
  group = groups,
  habitat_score = round(habitat_score, 4L),
  sex = rep(c("female", "male"), length.out = n_samples),
  library_size = library_size,
  stringsAsFactors = FALSE
)

phyla <- c("Bacillota", "Bacteroidota", "Pseudomonadota", "Actinomycetota")
oxygen_tolerance <- round(seq(0.08, 0.95, length.out = n_features), 3L)
metabolic_breadth <- round(runif(n_features, min = 0.15, max = 0.98), 3L)

feature_metadata <- data.frame(
  feature_id = feature_ids,
  phylum = rep(phyla, length.out = n_features),
  genus = sprintf("ExampleGenus_%02d", rep(seq_len(10L), length.out = n_features)),
  oxygen_tolerance = oxygen_tolerance,
  metabolic_breadth = metabolic_breadth,
  completeness_pct = round(runif(n_features, min = 91, max = 99.8), 2L),
  contamination_pct = round(runif(n_features, min = 0.1, max = 3.8), 2L),
  genome_size_bp = round(runif(n_features, min = 1.4e6, max = 5.3e6)),
  stringsAsFactors = FALSE
)

baseline <- exp(seq(log(5), log(70), length.out = n_features))
zoo_a_effect <- -0.35 + 0.8 * oxygen_tolerance
zoo_b_effect <- 0.25 - 0.65 * metabolic_breadth
habitat_effect <- -0.25 + 0.5 * metabolic_breadth

linear_predictor <- matrix(log(baseline), nrow = n_samples, ncol = n_features, byrow = TRUE)
linear_predictor <- linear_predictor + outer(habitat_score, habitat_effect)
linear_predictor[groups == "Zoo_A", ] <- sweep(
  linear_predictor[groups == "Zoo_A", , drop = FALSE],
  2L,
  zoo_a_effect,
  "+"
)
linear_predictor[groups == "Zoo_B", ] <- sweep(
  linear_predictor[groups == "Zoo_B", , drop = FALSE],
  2L,
  zoo_b_effect,
  "+"
)

effort <- library_size / mean(library_size)
means <- exp(linear_predictor) * effort
counts <- matrix(
  rnbinom(n_samples * n_features, mu = as.vector(means), size = 7),
  nrow = n_samples,
  ncol = n_features
)
colnames(counts) <- feature_ids

count_table <- data.frame(sample_id = sample_ids, counts, check.names = FALSE)

write.table(
  count_table,
  file.path(output_dir, "counts.csv"),
  row.names = FALSE,
  col.names = TRUE,
  sep = ",",
  quote = FALSE,
  eol = "\n"
)
write.table(
  sample_metadata,
  file.path(output_dir, "sample-metadata.csv"),
  row.names = FALSE,
  col.names = TRUE,
  sep = ",",
  quote = FALSE,
  eol = "\n"
)
write.table(
  feature_metadata,
  file.path(output_dir, "feature-metadata.csv"),
  row.names = FALSE,
  col.names = TRUE,
  sep = ",",
  quote = FALSE,
  eol = "\n"
)

build_clade <- function(labels) {
  if (length(labels) == 1L) {
    return(paste0(labels, ":0.100"))
  }

  midpoint <- floor(length(labels) / 2L)
  left <- build_clade(labels[seq_len(midpoint)])
  right <- build_clade(labels[seq.int(midpoint + 1L, length(labels))])
  paste0("(", left, ",", right, "):0.050")
}

tree <- paste0(sub(":0.050$", "", build_clade(feature_ids)), ";")
writeLines(tree, file.path(output_dir, "features.nwk"), useBytes = TRUE)
