prepare_focal_data <- function(entries, samples) {
  output <- data.frame(row.names = seq_len(nrow(samples)))
  encodings <- list()

  for (entry in entries) {
    name <- entry$column
    values <- samples[[name]]
    if (identical(entry$type, "categorical")) {
      observed <- unique(as.character(values))
      levels <- c(entry$referenceLevel, sort(setdiff(observed, entry$referenceLevel)))
      output[[name]] <- factor(as.character(values), levels = levels)
      encodings[[length(encodings) + 1L]] <- list(
        name = name,
        type = "categorical",
        levels = as.list(levels),
        referenceLevel = entry$referenceLevel
      )
    } else if (identical(entry$type, "continuous")) {
      numeric_values <- as.numeric(values)
      center <- mean(numeric_values)
      scale <- stats::sd(numeric_values)
      output[[name]] <- (numeric_values - center) / scale
      encodings[[length(encodings) + 1L]] <- list(
        name = name,
        type = "continuous",
        center = unname(center),
        scale = unname(scale)
      )
    } else {
      distinct <- sort(unique(as.character(values)))
      output[[name]] <- as.integer(as.character(values) == distinct[[2L]])
      encodings[[length(encodings) + 1L]] <- list(
        name = name,
        type = "binary",
        falseValue = scalar_json_value(distinct[[1L]]),
        trueValue = scalar_json_value(distinct[[2L]])
      )
    }
  }

  list(values = output, encodings = encodings)
}

prepare_trait_data <- function(entries, features) {
  output <- data.frame(row.names = seq_len(nrow(features)))
  for (entry in entries) {
    values <- features[[entry$column]]
    if (identical(entry$type, "continuous")) {
      output[[entry$column]] <- as.numeric(values)
    } else if (identical(entry$type, "categorical")) {
      output[[entry$column]] <- factor(values)
    } else {
      distinct <- sort(unique(as.character(values)))
      output[[entry$column]] <- as.integer(as.character(values) == distinct[[2L]])
    }
  }
  output
}

prepare_gllvm_data <- function(spec, data) {
  response_id <- spec$roles$response$sampleIdColumn
  sample_id <- spec$roles$samples$sampleIdColumn
  feature_roles <- spec$roles$features
  feature_id <- feature_roles$featureIdColumn
  response_names <- setdiff(names(data$count_table), response_id)
  sample_order <- match(data$count_table[[response_id]], data$sample_metadata[[sample_id]])
  feature_order <- match(response_names, data$feature_metadata[[feature_id]])
  samples <- data$sample_metadata[sample_order, , drop = FALSE]
  features <- data$feature_metadata[feature_order, , drop = FALSE]
  counts <- as.matrix(data$count_table[response_names])
  storage.mode(counts) <- "double"
  rownames(counts) <- as.character(data$count_table[[response_id]])
  colnames(counts) <- response_names

  qc <- feature_roles$technicalQc
  keep <- features[[qc$completenessColumn]] >= qc$filters$minimumCompleteness &
    features[[qc$contaminationColumn]] <= qc$filters$maximumContamination
  if (!any(keep)) {
    abort_metaspacer(
      "Technical QC filters removed every response feature.",
      "metaspacer_translation_error"
    )
  }
  counts <- counts[, keep, drop = FALSE]
  features <- features[keep, , drop = FALSE]

  tree <- data$tree
  if (!is.null(tree)) {
    removed <- setdiff(tree$tip.label, colnames(counts))
    if (length(removed) > 0L) {
      tree <- ape::drop.tip(tree, removed)
    }
    tree_order <- match(tree$tip.label, colnames(counts))
    counts <- counts[, tree_order, drop = FALSE]
    features <- features[
      match(tree$tip.label, features[[feature_id]]),
      ,
      drop = FALSE
    ]
  }

  focal <- prepare_focal_data(spec$roles$samples$focalVariables, samples)
  traits <- prepare_trait_data(feature_roles$functionalTraits, features)
  rownames(traits) <- colnames(counts)

  list(
    y = counts,
    sample_ids = rownames(counts),
    samples = samples,
    features = features,
    x = focal$values,
    predictor_encodings = focal$encodings,
    traits = traits,
    tree = tree,
    qc_removed = response_names[!keep]
  )
}

build_fixed_formula <- function(spec) {
  focal_names <- named_entries(spec$roles$samples$focalVariables, "column")
  if (!isTRUE(spec$model$fourthCorner$enabled)) {
    return(stats::reformulate(focal_names))
  }

  formula <- stats::as.formula(spec$model$fourthCorner$formula)
  terms <- attr(stats::terms(formula), "term.labels")
  present <- all.vars(formula)
  missing_focal <- setdiff(focal_names, present)
  stats::reformulate(unique(c(terms, missing_focal)))
}

build_design_metadata <- function(formula, x, encodings) {
  design <- stats::model.matrix(formula, data = x)
  columns <- lapply(colnames(design), function(column) {
    factors <- list()
    if (!identical(column, "(Intercept)")) {
      encoding_index <- which(vapply(encodings, function(item) {
        identical(column, item$name) ||
          (identical(item$type, "categorical") && startsWith(column, item$name))
      }, logical(1)))
      if (length(encoding_index) == 1L) {
        encoding <- encodings[[encoding_index]]
        if (identical(encoding$type, "categorical")) {
          level <- sub(paste0("^", encoding$name), "", column)
          factors <- list(list(
            predictor = encoding$name,
            operation = "indicator",
            level = level
          ))
        } else {
          factors <- list(list(
            predictor = encoding$name,
            operation = "identity"
          ))
        }
      }
    }
    list(name = column, factors = factors)
  })

  list(
    matrix = design,
    metadata = list(
      predictors = encodings,
      columns = columns
    )
  )
}

build_offset <- function(spec, prepared) {
  library_sizes <- rowSums(prepared$y)
  reference <- stats::median(library_sizes)
  offset <- matrix(
    log(library_sizes / reference),
    nrow = nrow(prepared$y),
    ncol = ncol(prepared$y)
  )
  qc <- spec$roles$features$technicalQc
  if (isTRUE(spec$model$offset$genomeSizeCorrection)) {
    genome_size <- prepared$features[[qc$genomeSizeColumn]]
    offset <- sweep(offset, 2L, log(genome_size / stats::median(genome_size)), "+")
  }
  if (isTRUE(spec$model$offset$completenessCorrection)) {
    completeness <- prepared$features[[qc$completenessColumn]] / 100
    offset <- sweep(offset, 2L, log(completeness), "+")
  }
  colnames(offset) <- colnames(prepared$y)
  rownames(offset) <- rownames(prepared$y)

  list(
    values = offset,
    reference = unname(reference)
  )
}

build_phylogenetic_matrix <- function(spec, tree) {
  if (!isTRUE(spec$model$phylogeneticRandomEffect$enabled)) {
    return(NULL)
  }
  covariance_type <- spec$model$phylogeneticRandomEffect$covariance
  if (identical(covariance_type, "vcv")) {
    covariance <- ape::vcv.phylo(tree, corr = TRUE)
  } else {
    distances <- as.matrix(ape::cophenetic.phylo(tree))
    positive <- distances[distances > 0]
    range <- if (length(positive) == 0L) 1 else stats::median(positive)
    covariance <- exp(-distances / range)
  }
  covariance <- covariance[tree$tip.label, tree$tip.label, drop = FALSE]

  if (identical(spec$model$phylogeneticRandomEffect$approximation, "nngp")) {
    distances <- as.matrix(ape::cophenetic.phylo(tree))
    return(list(covariance, dist = distances))
  }
  covariance
}

engine_translate.metaspacer_engine_gllvm <- function(engine, spec, data) {
  prepared <- prepare_gllvm_data(spec, data)
  formula <- build_fixed_formula(spec)
  focal_names <- named_entries(spec$roles$samples$focalVariables, "column")
  design_formula <- stats::reformulate(focal_names)
  design <- build_design_metadata(
    design_formula,
    prepared$x,
    prepared$predictor_encodings
  )
  offset <- build_offset(spec, prepared)
  family <- if (identical(spec$model$family, "zinb")) "ZINB" else "negative.binomial"
  call_args <- list(
    y = prepared$y,
    X = prepared$x,
    formula = formula,
    family = family,
    num.lv = spec$model$latentVariables,
    offset = offset$values,
    method = "VA",
    seed = spec$seed,
    scale.X = FALSE,
    sd.errors = TRUE
  )

  if (isTRUE(spec$model$fourthCorner$enabled)) {
    call_args$TR <- prepared$traits
  }

  phylogenetic <- build_phylogenetic_matrix(spec, prepared$tree)
  if (!is.null(phylogenetic)) {
    call_args$colMat <- phylogenetic
    call_args$colMat.rho.struct <- "single"
    call_args$beta0com <- TRUE
    if (isTRUE(spec$model$fourthCorner$enabled)) {
      call_args$X$metaspacer_intercept <- 1
      call_args$randomX <- stats::reformulate(
        c("metaspacer_intercept", focal_names),
        intercept = FALSE
      )
    } else {
      random_terms <- paste(c("1", focal_names), collapse = " + ")
      call_args$formula <- stats::as.formula(paste0("~ (", random_terms, " | 1)"))
    }
    if (is.list(phylogenetic)) {
      call_args$control <- list(
        nn.colMat = min(10L, ncol(prepared$y) - 1L),
        colMat.approx = "NNGP"
      )
    }
  }

  warnings <- character()
  if (length(prepared$qc_removed) > 0L) {
    warnings <- c(
      warnings,
      paste0(length(prepared$qc_removed), " response features were removed by QC filters.")
    )
  }
  if (!is.null(spec$resources$cpuAffinity)) {
    warnings <- c(
      warnings,
      "cpuAffinity is runner-owned and was not applied inside the pure R package."
    )
  }
  if (!is.null(spec$resources$memoryHardLimitMB)) {
    warnings <- c(
      warnings,
      "memoryHardLimitMB is runner-owned and was not applied inside the pure R package."
    )
  }

  structure(
    list(
      engine = engine$name,
      spec = spec,
      prepared = prepared,
      formula = formula,
      design_formula = design_formula,
      design = design,
      offset = offset,
      call_args = call_args,
      cpu_threads = spec$resources$cpuThreads,
      warnings = warnings
    ),
    class = "metaspacer_gllvm_translation"
  )
}

engine_fit.metaspacer_engine_gllvm <- function(engine, translation) {
  loadNamespace("gllvm")
  TMB::openmp(translation$cpu_threads, autopar = TRUE)
  captured_warnings <- character()
  fit <- withCallingHandlers(
    do.call(gllvm::gllvm, translation$call_args),
    warning = function(warning) {
      captured_warnings <<- c(captured_warnings, conditionMessage(warning))
      invokeRestart("muffleWarning")
    }
  )
  attr(fit, "metaspacer_warnings") <- unique(captured_warnings)
  fit
}
