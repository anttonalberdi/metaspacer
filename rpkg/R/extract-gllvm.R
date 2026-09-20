make_projection_basis <- function(translation) {
  encodings <- translation$prepared$predictor_encodings
  coefficient_count <- ncol(translation$design$matrix)
  basis <- data.frame(row.names = seq_len(coefficient_count))

  for (encoding in encodings) {
    if (identical(encoding$type, "categorical")) {
      values <- rep(encoding$referenceLevel, coefficient_count)
      basis[[encoding$name]] <- factor(values, levels = unlist(encoding$levels))
    } else {
      basis[[encoding$name]] <- rep(0, coefficient_count)
    }
  }

  columns <- translation$design$metadata$columns
  for (index in seq_along(columns)) {
    factors <- columns[[index]]$factors
    if (length(factors) == 0L) {
      next
    }
    factor <- factors[[1L]]
    encoding <- encodings[[which(vapply(
      encodings,
      function(item) identical(item$name, factor$predictor),
      logical(1)
    ))]]
    if (identical(factor$operation, "indicator")) {
      values <- as.character(basis[[factor$predictor]])
      values[[index]] <- factor$level
      basis[[factor$predictor]] <- factor(values, levels = unlist(encoding$levels))
    } else {
      basis[[factor$predictor]][[index]] <- 1
    }
  }

  if ("metaspacer_intercept" %in% names(translation$call_args$X)) {
    basis$metaspacer_intercept <- 1
  }
  basis
}

extract_beta <- function(fit, translation) {
  basis <- make_projection_basis(translation)
  design <- stats::model.matrix(translation$design_formula, data = basis)
  predictions <- stats::predict(
    fit,
    newX = basis,
    level = 0,
    type = "link",
    offset = FALSE
  )
  beta <- solve(design, predictions)
  rownames(beta) <- colnames(design)
  colnames(beta) <- colnames(translation$prepared$y)
  beta
}

extract_latent_components <- function(fit, translation) {
  latent_count <- translation$spec$model$latentVariables
  response_count <- ncol(translation$prepared$y)
  sample_count <- nrow(translation$prepared$y)
  if (latent_count == 0L) {
    return(list(
      scores = matrix(numeric(), nrow = sample_count, ncol = 0L),
      loadings = matrix(numeric(), nrow = 0L, ncol = response_count),
      mean = numeric(),
      covariance = matrix(numeric(), nrow = 0L, ncol = 0L)
    ))
  }

  scores <- as.matrix(gllvm::getLV(fit))
  loadings_by_response <- tryCatch(
    as.matrix(gllvm::getLoadings(fit)),
    error = function(error) {
      sweep(as.matrix(fit$params$theta), 2L, fit$params$sigma.lv, "*")
    }
  )
  loadings <- t(loadings_by_response)
  covariance <- if (latent_count == 1L) {
    matrix(stats::var(scores[, 1L]), nrow = 1L, ncol = 1L)
  } else {
    stats::cov(scores)
  }
  list(
    scores = scores,
    loadings = loadings,
    mean = unname(colMeans(scores)),
    covariance = unname(covariance)
  )
}

extract_projection <- function(fit, translation) {
  eta <- as.matrix(stats::predict(fit, level = 1, type = "link", offset = FALSE))
  component <- stats::prcomp(eta, center = TRUE, scale. = FALSE)
  if (ncol(component$rotation) < 2L) {
    abort_metaspacer(
      "At least two ordination axes are required by the results-bundle contract.",
      "metaspacer_extraction_error"
    )
  }
  rotation <- component$rotation[, seq_len(2L), drop = FALSE]
  scores <- sweep(eta, 2L, component$center, "-") %*% rotation
  colnames(scores) <- c("Space 1", "Space 2")
  list(
    eta = eta,
    center = unname(component$center),
    rotation = unname(rotation),
    scores = unname(scores)
  )
}

empirical_estimate <- function(value, standard_error = 0, bounds = c(-Inf, Inf)) {
  if (!is.finite(value)) {
    value <- 0
  }
  half_width <- 1.96 * if (is.finite(standard_error)) max(0, standard_error) else 0
  list(
    median = unname(value),
    lower = unname(max(bounds[[1L]], value - half_width)),
    upper = unname(min(bounds[[2L]], value + half_width)),
    level = 0.95,
    intervalType = "empirical"
  )
}

reference_group <- function(translation) {
  encodings <- translation$prepared$predictor_encodings
  categorical <- Filter(function(item) identical(item$type, "categorical"), encodings)
  if (length(categorical) == 0L) {
    return(list(column = NULL, reference = "Observed"))
  }
  list(column = categorical[[1L]]$name, reference = categorical[[1L]]$referenceLevel)
}

metric_dispersion <- function(scores, groups, reference) {
  selected <- scores[groups == reference, , drop = FALSE]
  center <- colMeans(selected)
  distances <- sqrt(rowSums(sweep(selected, 2L, center, "-")^2))
  c(value = mean(distances), se = stats::sd(distances) / sqrt(length(distances)))
}

metric_effective_dimensionality <- function(eta) {
  eigenvalues <- pmax(eigen(stats::cov(eta), symmetric = TRUE, only.values = TRUE)$values, 0)
  denominator <- sum(eigenvalues^2)
  if (denominator == 0) 0 else sum(eigenvalues)^2 / denominator
}

metric_schoener <- function(y, groups, reference) {
  alternatives <- setdiff(unique(groups), reference)
  if (length(alternatives) == 0L) {
    return(1)
  }
  normalize <- function(values) values / sum(values)
  reference_composition <- normalize(colSums(y[groups == reference, , drop = FALSE]))
  comparison <- normalize(colSums(y[groups == alternatives[[1L]], , drop = FALSE]))
  1 - 0.5 * sum(abs(reference_composition - comparison))
}

metric_containment <- function(scores, groups, reference) {
  reference_scores <- scores[groups == reference, , drop = FALSE]
  comparison_scores <- scores[groups != reference, , drop = FALSE]
  if (nrow(comparison_scores) == 0L) {
    return(1)
  }
  covariance <- stats::cov(reference_scores) + diag(1e-8, ncol(reference_scores))
  distances <- stats::mahalanobis(
    comparison_scores,
    center = colMeans(reference_scores),
    cov = covariance
  )
  mean(distances <= stats::qchisq(0.95, df = ncol(reference_scores)))
}

metric_transition <- function(scores, groups, reference) {
  alternatives <- setdiff(unique(groups), reference)
  if (length(alternatives) == 0L) {
    return(0)
  }
  start <- colMeans(scores[groups == reference, , drop = FALSE])
  end <- colMeans(scores[groups == alternatives[[1L]], , drop = FALSE])
  sqrt(sum((start - end)^2))
}

metric_variance_partition <- function(observed, fitted) {
  total <- sum((observed - mean(observed))^2)
  if (total == 0) {
    return(0)
  }
  max(0, min(1, 1 - sum((observed - fitted)^2) / total))
}

metric_chao_coverage <- function(y) {
  totals <- colSums(y)
  abundance <- sum(totals)
  if (abundance == 0) {
    return(0)
  }
  singletons <- sum(totals == 1)
  max(0, min(1, 1 - singletons / abundance))
}

make_smoke_metrics <- function(fit, translation, projection) {
  group_info <- reference_group(translation)
  if (is.null(group_info$column)) {
    groups <- rep(group_info$reference, nrow(projection$scores))
  } else {
    groups <- as.character(translation$prepared$samples[[group_info$column]])
  }
  dispersion <- metric_dispersion(projection$scores, groups, group_info$reference)
  dimensionality <- metric_effective_dimensionality(projection$eta)
  schoener <- metric_schoener(translation$prepared$y, groups, group_info$reference)
  containment <- metric_containment(projection$scores, groups, group_info$reference)
  transition <- metric_transition(projection$scores, groups, group_info$reference)
  plasticity <- if (dispersion[["value"]] == 0) 0 else transition / dispersion[["value"]]
  fitted <- as.matrix(stats::predict(fit, type = "response"))
  variance <- metric_variance_partition(translation$prepared$y, fitted)
  coverage <- metric_chao_coverage(translation$prepared$y)
  note <- paste(
    "M2 smoke-extraction interval; resampling-based metric uncertainty is added in M3."
  )
  make_metric <- function(id, label, value, se, unit, scope, bounds = c(-Inf, Inf)) {
    list(
      id = id,
      label = label,
      tier = "measured",
      estimate = empirical_estimate(value, se, bounds),
      unit = unit,
      scope = scope,
      note = note
    )
  }

  list(
    make_metric(
      "dispersion",
      paste0(group_info$reference, " oscillation"),
      dispersion[["value"]],
      dispersion[["se"]],
      "ordination_sd",
      list(group = group_info$reference),
      c(0, Inf)
    ),
    make_metric(
      "effective_dimensionality",
      "Effective dimensionality",
      dimensionality,
      0,
      "dimensions",
      list(dataset = "all"),
      c(0, Inf)
    ),
    make_metric(
      "schoener_d",
      "Schoener's D overlap",
      schoener,
      0,
      "proportion",
      list(referenceGroup = group_info$reference),
      c(0, 1)
    ),
    make_metric(
      "containment",
      "Reference-space containment",
      containment,
      0,
      "proportion",
      list(referenceGroup = group_info$reference),
      c(0, 1)
    ),
    make_metric(
      "transition_distance",
      "Transition distance",
      transition,
      0,
      "ordination_distance",
      list(referenceGroup = group_info$reference),
      c(0, Inf)
    ),
    make_metric(
      "plasticity",
      "Relative plasticity",
      plasticity,
      0,
      "relative_distance",
      list(referenceGroup = group_info$reference),
      c(0, Inf)
    ),
    make_metric(
      "variance_partition",
      "Modelled variance fraction",
      variance,
      0,
      "proportion",
      list(component = "modelled"),
      c(0, 1)
    ),
    make_metric(
      "chao_coverage",
      "Chao sample coverage",
      coverage,
      0,
      "proportion",
      list(dataset = "all"),
      c(0, 1)
    )
  )
}

make_observed_states <- function(translation, projection) {
  focal_entries <- translation$spec$roles$samples$focalVariables
  group_info <- reference_group(translation)
  axis_standard_errors <- apply(projection$scores, 2L, stats::sd) /
    sqrt(nrow(projection$scores))

  lapply(seq_len(nrow(projection$scores)), function(index) {
    condition <- list()
    for (entry in focal_entries) {
      condition[[entry$column]] <- scalar_json_value(
        translation$prepared$samples[[entry$column]][[index]]
      )
    }
    group <- if (is.null(group_info$column)) {
      "Observed"
    } else {
      as.character(translation$prepared$samples[[group_info$column]][[index]])
    }
    coordinates <- lapply(seq_len(2L), function(axis) {
      list(
        axis = paste("Space", axis),
        estimate = empirical_estimate(
          projection$scores[index, axis],
          axis_standard_errors[[axis]]
        )
      )
    })
    list(
      stateId = paste0("observed-", translation$prepared$sample_ids[[index]]),
      sampleId = translation$prepared$sample_ids[[index]],
      kind = "observed",
      group = group,
      condition = condition,
      tier = "measured",
      coordinates = coordinates,
      geometry = list(
        method = "mixed_hull_range",
        insideSampledDomain = TRUE,
        distanceToDomain = 0
      )
    )
  })
}

extract_uncertainty <- function(fit, beta, loadings) {
  parameter_order <- c(
    unlist(lapply(seq_len(nrow(beta)), function(row) {
      paste0("Beta[", rownames(beta)[[row]], ",", colnames(beta), "]")
    })),
    unlist(lapply(seq_len(nrow(loadings)), function(row) {
      paste0("Lambda[LV", row, ",", colnames(loadings), "]")
    }))
  )
  standard_errors <- unlist(fit$sd, recursive = TRUE, use.names = FALSE)
  standard_errors <- standard_errors[is.finite(standard_errors) & standard_errors > 0]
  fallback_variance <- if (length(standard_errors) == 0L) {
    .Machine$double.eps
  } else {
    stats::median(standard_errors)^2
  }
  list(
    kind = "sampling_covariance",
    parameterOrder = as.list(parameter_order),
    covariance = list(
      representation = "diagonal",
      diagonal = as.list(rep(unname(fallback_variance), length(parameter_order)))
    )
  )
}

extract_family <- function(fit, spec) {
  if (identical(spec$model$family, "zinb")) {
    return(list(
      name = "zinb",
      link = "log",
      dispersion = as.list(unname(fit$params$ZINB.inv.phi)),
      zeroInflation = as.list(unname(fit$params$phi))
    ))
  }
  list(
    name = "negative_binomial",
    link = "log",
    dispersion = as.list(unname(fit$params$inv.phi))
  )
}

engine_extract.metaspacer_engine_gllvm <- function(engine, fit, translation, context) {
  beta <- extract_beta(fit, translation)
  latent <- extract_latent_components(fit, translation)
  projection <- extract_projection(fit, translation)
  response_features <- colnames(translation$prepared$y)
  warnings <- unique(c(
    translation$warnings,
    attr(fit, "metaspacer_warnings"),
    "M2 uses a diagonal sampling-covariance approximation; M3 adds resampled intervals."
  ))

  list(
    bundleVersion = "1.0.0",
    specVersion = translation$spec$specVersion,
    precomputed = list(
      metrics = make_smoke_metrics(fit, translation, projection),
      ordination = list(
        axisLabels = list("Space 1", "Space 2"),
        states = make_observed_states(translation, projection)
      )
    ),
    fittedParameters = list(
      dimensions = list(
        responses = length(response_features),
        coefficients = nrow(beta),
        latentVariables = nrow(latent$loadings),
        projectionAxes = 2L
      ),
      responseFeatures = as.list(response_features),
      coefficientNames = as.list(rownames(beta)),
      design = translation$design$metadata,
      offset = list(
        librarySize = list(
          source = "count_table_row_sum",
          transform = "log",
          referenceValue = translation$offset$reference
        ),
        genomeSizeCorrection = isTRUE(translation$spec$model$offset$genomeSizeCorrection),
        completenessCorrection = isTRUE(
          translation$spec$model$offset$completenessCorrection
        )
      ),
      beta = unname(beta),
      latentLoadings = unname(latent$loadings),
      latentDistribution = list(
        mean = as.list(latent$mean),
        covariance = latent$covariance
      ),
      projection = list(
        center = as.list(projection$center),
        rotation = projection$rotation
      ),
      family = extract_family(fit, translation$spec),
      uncertainty = extract_uncertainty(fit, beta, latent$loadings)
    ),
    provenance = list(
      specSha256 = context$spec_hash,
      dataSha256 = context$data_hashes,
      engine = list(
        name = engine$name,
        version = as.character(utils::packageVersion("gllvm"))
      ),
      metaspacerVersion = as.character(utils::packageVersion("metaspacer")),
      seed = as.integer(translation$spec$seed),
      createdAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
      tierDefinitions = list(
        measured = "Computed directly from observed samples.",
        interpolated = paste(
          "Model prediction inside the geometrically sampled condition domain."
        ),
        extrapolated = paste(
          "Model prediction outside the sampled condition domain; an fMS proxy only."
        )
      ),
      extrapolationMethod = list(
        name = "mixed_hull_range",
        conditionColumns = as.list(named_entries(
          translation$spec$roles$samples$focalVariables,
          "column"
        ))
      ),
      warnings = as.list(warnings)
    )
  )
}
