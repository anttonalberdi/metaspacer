engine_validate.metaspacer_engine_gllvm <- function(engine, spec, data) {
  errors <- list()
  warnings <- list()
  add_error <- function(code, path, message, details = list()) {
    errors[[length(errors) + 1L]] <<- validation_issue(code, path, message, details)
  }

  response_id <- spec$roles$response$sampleIdColumn
  sample_id <- spec$roles$samples$sampleIdColumn
  feature_id <- spec$roles$features$featureIdColumn
  count_table <- data$count_table
  samples <- data$sample_metadata
  features <- data$feature_metadata

  if (!response_id %in% names(count_table)) {
    add_error(
      "missing_sample_id_column",
      "/roles/response/sampleIdColumn",
      paste0("Count table has no '", response_id, "' column.")
    )
  }
  if (!sample_id %in% names(samples)) {
    add_error(
      "missing_sample_id_column",
      "/roles/samples/sampleIdColumn",
      paste0("Sample metadata has no '", sample_id, "' column.")
    )
  }
  if (!feature_id %in% names(features)) {
    add_error(
      "missing_feature_id_column",
      "/roles/features/featureIdColumn",
      paste0("Feature metadata has no '", feature_id, "' column.")
    )
  }
  if (length(errors) > 0L) {
    return(validation_result(errors, warnings))
  }

  count_ids <- as.character(count_table[[response_id]])
  sample_ids <- as.character(samples[[sample_id]])
  if (anyDuplicated(count_ids)) {
    add_error("duplicate_sample_id", "/data/countTable", "Count-table sample IDs are not unique.")
  }
  if (anyDuplicated(sample_ids)) {
    add_error(
      "duplicate_sample_id",
      "/data/sampleMetadata",
      "Sample-metadata sample IDs are not unique."
    )
  }
  matched_samples <- sum(count_ids %in% sample_ids)
  if (!setequal(count_ids, sample_ids)) {
    add_error(
      "sample_id_mismatch",
      "/data/sampleMetadata",
      paste0(
        matched_samples,
        "/",
        length(count_ids),
        " count-table samples matched sample metadata; ",
        length(count_ids) - matched_samples,
        " unmatched."
      ),
      list(
        missingFromMetadata = setdiff(count_ids, sample_ids),
        missingFromCounts = setdiff(sample_ids, count_ids)
      )
    )
  }

  response_names <- setdiff(names(count_table), response_id)
  feature_ids <- as.character(features[[feature_id]])
  if (anyDuplicated(response_names)) {
    add_error("duplicate_feature_id", "/data/countTable", "Response feature names are not unique.")
  }
  if (anyDuplicated(feature_ids)) {
    add_error(
      "duplicate_feature_id",
      "/data/featureMetadata",
      "Feature-metadata IDs are not unique."
    )
  }
  matched_features <- sum(response_names %in% feature_ids)
  if (!setequal(response_names, feature_ids)) {
    add_error(
      "feature_id_mismatch",
      "/data/featureMetadata",
      paste0(
        matched_features,
        "/",
        length(response_names),
        " response features matched feature metadata; ",
        length(response_names) - matched_features,
        " unmatched."
      ),
      list(
        missingFromMetadata = setdiff(response_names, feature_ids),
        missingFromCounts = setdiff(feature_ids, response_names)
      )
    )
  }

  response_values <- count_table[response_names]
  numeric_columns <- vapply(response_values, is.numeric, logical(1))
  if (!all(numeric_columns)) {
    add_error(
      "non_numeric_counts",
      "/data/countTable",
      paste0(
        "Non-numeric response columns: ",
        paste(response_names[!numeric_columns], collapse = ", ")
      )
    )
  } else {
    count_matrix <- as.matrix(response_values)
    if (anyNA(count_matrix) || any(count_matrix < 0) || any(count_matrix %% 1 != 0)) {
      add_error(
        "invalid_counts",
        "/data/countTable",
        "Counts must be non-negative integers with no missing values."
      )
    }
    empty_rows <- which(rowSums(count_matrix) == 0)
    if (length(empty_rows) > 0L) {
      add_error(
        "empty_samples",
        "/data/countTable",
        paste0(length(empty_rows), " samples have zero library size."),
        list(sampleIds = count_ids[empty_rows])
      )
    }
  }

  focal_entries <- spec$roles$samples$focalVariables
  focal_names <- named_entries(focal_entries, "column")
  missing_focal <- setdiff(focal_names, names(samples))
  if (length(missing_focal) > 0L) {
    add_error(
      "missing_focal_variable",
      "/roles/samples/focalVariables",
      paste0("Missing focal variables: ", paste(missing_focal, collapse = ", "))
    )
  }
  for (entry in focal_entries) {
    if (!entry$column %in% names(samples)) {
      next
    }
    values <- samples[[entry$column]]
    if (anyNA(values)) {
      add_error(
        "missing_focal_value",
        paste0("/roles/samples/focalVariables/", entry$column),
        paste0("Focal variable '", entry$column, "' contains missing values.")
      )
    }
    if (identical(entry$type, "continuous")) {
      numeric_values <- suppressWarnings(as.numeric(values))
      if (anyNA(numeric_values) || stats::sd(numeric_values) == 0) {
        add_error(
          "invalid_continuous_variable",
          paste0("/roles/samples/focalVariables/", entry$column),
          "Continuous focal variables must be numeric and have non-zero variance."
        )
      }
    }
    if (identical(entry$type, "categorical")) {
      levels <- unique(as.character(values))
      if (length(levels) < 2L || !entry$referenceLevel %in% levels) {
        add_error(
          "invalid_categorical_variable",
          paste0("/roles/samples/focalVariables/", entry$column),
          "Categorical variables need at least two levels and the declared reference level."
        )
      }
    }
    if (identical(entry$type, "binary") && length(unique(values)) != 2L) {
      add_error(
        "invalid_binary_variable",
        paste0("/roles/samples/focalVariables/", entry$column),
        "Binary focal variables must contain exactly two distinct values."
      )
    }
  }

  feature_roles <- spec$roles$features
  trait_names <- named_entries(feature_roles$functionalTraits, "column")
  technical_names <- c(
    feature_roles$technicalQc$completenessColumn,
    feature_roles$technicalQc$contaminationColumn,
    feature_roles$technicalQc$genomeSizeColumn
  )
  required_feature_columns <- unique(c(
    feature_roles$taxonomyColumns,
    trait_names,
    technical_names
  ))
  missing_feature_columns <- setdiff(required_feature_columns, names(features))
  if (length(missing_feature_columns) > 0L) {
    add_error(
      "missing_feature_column",
      "/roles/features",
      paste0("Missing feature columns: ", paste(missing_feature_columns, collapse = ", "))
    )
  }
  overlap <- intersect(trait_names, technical_names)
  allowed_overlap <- if (isTRUE(feature_roles$technicalQc$genomeSizeHasEcologicalRole)) {
    feature_roles$technicalQc$genomeSizeColumn
  } else {
    character()
  }
  forbidden_overlap <- setdiff(overlap, allowed_overlap)
  if (length(forbidden_overlap) > 0L) {
    add_error(
      "technical_trait_overlap",
      "/roles/features/functionalTraits",
      paste0(
        "Technical QC columns cannot silently be ecological traits: ",
        paste(forbidden_overlap, collapse = ", ")
      )
    )
  }

  if (isTRUE(spec$model$fourthCorner$enabled)) {
    formula <- tryCatch(
      stats::as.formula(spec$model$fourthCorner$formula),
      error = function(error) NULL
    )
    if (is.null(formula)) {
      add_error(
        "invalid_fourth_corner_formula",
        "/model/fourthCorner/formula",
        "The fourth-corner formula could not be parsed."
      )
    } else {
      unknown_terms <- setdiff(all.vars(formula), c(focal_names, trait_names))
      if (length(unknown_terms) > 0L) {
        add_error(
          "unknown_formula_variable",
          "/model/fourthCorner/formula",
          paste0("Unknown formula variables: ", paste(unknown_terms, collapse = ", "))
        )
      }
    }
  }

  if (isTRUE(spec$model$phylogeneticRandomEffect$enabled)) {
    if (is.null(data$tree)) {
      add_error(
        "missing_phylogenetic_tree",
        "/data/phylogeneticTree",
        "Phylogenetic random effects require a tree."
      )
    } else {
      matched_tips <- sum(response_names %in% data$tree$tip.label)
      if (!setequal(response_names, data$tree$tip.label)) {
        add_error(
          "tree_tip_mismatch",
          "/data/phylogeneticTree",
          paste0(
            matched_tips,
            "/",
            length(response_names),
            " response features matched the tree; ",
            length(response_names) - matched_tips,
            " unmatched."
          ),
          list(
            missingFromTree = setdiff(response_names, data$tree$tip.label),
            missingFromCounts = setdiff(data$tree$tip.label, response_names)
          )
        )
      }
    }
  }

  if (!spec$model$family %in% c("negative_binomial", "zinb")) {
    add_error(
      "unsupported_family",
      "/model/family",
      "gllvm supports negative_binomial and zinb in the current contract."
    )
  }
  if (spec$model$latentVariables >= length(response_names)) {
    add_error(
      "invalid_latent_dimension",
      "/model/latentVariables",
      "The number of latent variables must be smaller than the response count."
    )
  }

  validation_result(errors, warnings)
}

engine_estimate_cost.metaspacer_engine_gllvm <- function(engine, spec, data) {
  response_id <- spec$roles$response$sampleIdColumn
  sample_count <- nrow(data$count_table)
  response_count <- ncol(data$count_table) - 1L
  latent_count <- spec$model$latentVariables
  focal_count <- length(spec$roles$samples$focalVariables)
  trait_count <- length(spec$roles$features$functionalTraits)
  phylogenetic_multiplier <- if (isTRUE(spec$model$phylogeneticRandomEffect$enabled)) 2.5 else 1
  work_units <- sample_count * response_count *
    max(1, latent_count + focal_count + trait_count) * phylogenetic_multiplier
  memory_mb <- 128 + (sample_count * response_count * 8 * 12) / 1024^2 +
    (response_count^2 * 8 * phylogenetic_multiplier) / 1024^2
  seconds <- max(1, work_units / 15000)

  list(
    engine = engine$name,
    samples = sample_count,
    responses = response_count,
    latentVariables = latent_count,
    estimatedMemoryMB = ceiling(memory_mb),
    estimatedRuntimeSeconds = list(
      lower = ceiling(seconds * 0.5),
      upper = ceiling(seconds * 4)
    ),
    responseIdColumn = response_id,
    guidance = if (response_count > 500L) {
      "Consider aggregating sparse taxonomic features into functional responses."
    } else {
      "Response dimensionality is within the intended laptop-scale range."
    }
  )
}
