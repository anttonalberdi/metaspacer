make_test_fixture <- function(directory, sample_count = 24L, response_count = 6L) {
  set.seed(731)
  sample_ids <- sprintf("S%03d", seq_len(sample_count))
  response_ids <- sprintf("F%03d", seq_len(response_count))
  groups <- rep(c("Reference", "Changed"), each = sample_count / 2L)
  habitat <- seq(-1, 1, length.out = sample_count)
  means <- outer(
    exp(2.5 + 0.35 * (groups == "Changed") + 0.2 * habitat),
    seq(0.8, 1.2, length.out = response_count)
  )
  counts <- matrix(
    stats::rnbinom(length(means), mu = as.vector(means), size = 8),
    nrow = sample_count,
    ncol = response_count
  )
  counts <- data.frame(sample_id = sample_ids, counts, check.names = FALSE)
  names(counts)[-1L] <- response_ids
  samples <- data.frame(
    sample_id = sample_ids,
    group = groups,
    habitat_score = habitat
  )
  features <- data.frame(
    feature_id = response_ids,
    taxonomy = rep("Synthetic", response_count),
    completeness_pct = rep(98, response_count),
    contamination_pct = rep(1, response_count),
    genome_size_bp = seq(2000000, 2500000, length.out = response_count)
  )

  utils::write.csv(counts, file.path(directory, "counts.csv"), row.names = FALSE)
  utils::write.csv(samples, file.path(directory, "samples.csv"), row.names = FALSE)
  utils::write.csv(features, file.path(directory, "features.csv"), row.names = FALSE)
  hash <- function(path) {
    digest::digest(file = file.path(directory, path), algo = "sha256", serialize = FALSE)
  }
  spec <- list(
    specVersion = "1.0.0",
    data = list(
      countTable = list(path = "counts.csv", sha256 = hash("counts.csv"), format = "csv"),
      sampleMetadata = list(path = "samples.csv", sha256 = hash("samples.csv"), format = "csv"),
      featureMetadata = list(path = "features.csv", sha256 = hash("features.csv"), format = "csv")
    ),
    roles = list(
      response = list(table = "countTable", sampleIdColumn = "sample_id"),
      samples = list(
        table = "sampleMetadata",
        sampleIdColumn = "sample_id",
        focalVariables = list(
          list(
            column = "group",
            type = "categorical",
            referenceLevel = "Reference"
          ),
          list(column = "habitat_score", type = "continuous")
        )
      ),
      features = list(
        table = "featureMetadata",
        featureIdColumn = "feature_id",
        taxonomyColumns = list("taxonomy"),
        functionalTraits = list(),
        technicalQc = list(
          completenessColumn = "completeness_pct",
          contaminationColumn = "contamination_pct",
          genomeSizeColumn = "genome_size_bp",
          filters = list(minimumCompleteness = 90, maximumContamination = 5),
          genomeSizeHasEcologicalRole = FALSE
        )
      )
    ),
    model = list(
      family = "negative_binomial",
      offset = list(
        librarySize = TRUE,
        genomeSizeCorrection = FALSE,
        completenessCorrection = FALSE
      ),
      latentVariables = 1L,
      phylogeneticRandomEffect = list(
        enabled = FALSE,
        covariance = "vcv",
        approximation = "full",
        preserveTipOrder = TRUE
      ),
      fourthCorner = list(enabled = FALSE, formula = NULL)
    ),
    engine = "gllvm",
    resources = list(cpuThreads = 1L, memorySoftLimitMB = 512L),
    seed = 731L,
    output = list(path = "out", overwrite = TRUE)
  )
  spec_path <- file.path(directory, "spec.json")
  jsonlite::write_json(
    spec,
    spec_path,
    auto_unbox = TRUE,
    pretty = TRUE,
    null = "null"
  )
  list(
    spec = spec,
    spec_path = spec_path,
    counts = counts,
    samples = samples,
    features = features
  )
}
