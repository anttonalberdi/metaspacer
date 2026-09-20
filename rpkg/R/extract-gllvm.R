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
  observed_eta <- log(translation$prepared$y + 0.5) - translation$offset$values
  observed_scores <- sweep(observed_eta, 2L, component$center, "-") %*% rotation
  colnames(scores) <- c("Space 1", "Space 2")
  colnames(observed_scores) <- c("Space 1", "Space 2")
  list(
    eta = eta,
    observed_eta = observed_eta,
    center = unname(component$center),
    rotation = unname(rotation),
    scores = unname(scores),
    observed_scores = unname(observed_scores)
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

observed_groups <- function(translation, group_info = reference_group(translation)) {
  if (is.null(group_info$column)) {
    return(rep(group_info$reference, nrow(translation$prepared$y)))
  }
  as.character(translation$prepared$samples[[group_info$column]])
}

make_observed_states <- function(translation, projection) {
  focal_entries <- translation$spec$roles$samples$focalVariables
  group_info <- reference_group(translation)
  axis_standard_errors <- apply(projection$observed_scores, 2L, stats::sd) /
    sqrt(nrow(projection$observed_scores))

  lapply(seq_len(nrow(projection$observed_scores)), function(index) {
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
          projection$observed_scores[index, axis],
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

fallback_variance <- function(fit) {
  standard_errors <- unlist(fit$sd, recursive = TRUE, use.names = FALSE)
  standard_errors <- standard_errors[is.finite(standard_errors) & standard_errors > 0]
  if (length(standard_errors) == 0L) {
    return(.Machine$double.eps)
  }
  unname(stats::median(standard_errors)^2)
}

extract_fixed_covariance <- function(fit, beta) {
  parameter_count <- length(beta)
  fallback <- diag(fallback_variance(fit), parameter_count)
  covariance <- tryCatch(as.matrix(stats::vcov(fit)), error = function(error) NULL)
  if (is.null(covariance)) {
    return(list(values = fallback, warning = paste(
      "The fitted Hessian covariance was unavailable; fixed-effect draws use a",
      "diagonal standard-error fallback."
    )))
  }
  fixed_indices <- which(rownames(covariance) == "b")
  if (length(fixed_indices) != parameter_count) {
    return(list(values = fallback, warning = paste(
      "The fitted Hessian could not be mapped to projected coefficients;",
      "fixed-effect draws use a diagonal standard-error fallback."
    )))
  }
  response_major <- covariance[fixed_indices, fixed_indices, drop = FALSE]
  raw_indices <- matrix(seq_len(parameter_count), nrow = nrow(beta))
  coefficient_major <- as.vector(t(raw_indices))
  values <- response_major[coefficient_major, coefficient_major, drop = FALSE]
  values[!is.finite(values)] <- 0
  diagonal <- diag(values)
  diag(values) <- ifelse(diagonal > 0, diagonal, fallback_variance(fit))
  list(values = (values + t(values)) / 2, warning = NULL)
}

extract_loading_variances <- function(fit, loadings) {
  if (length(loadings) == 0L) {
    return(numeric())
  }
  fallback <- fallback_variance(fit)
  if (is.null(fit$sd$theta)) {
    return(rep(fallback, length(loadings)))
  }
  theta <- as.matrix(fit$params$theta)[, seq_len(nrow(loadings)), drop = FALSE]
  theta_sd <- as.matrix(fit$sd$theta)[, seq_len(nrow(loadings)), drop = FALSE]
  sigma <- rep(fit$params$sigma.lv, length.out = nrow(loadings))
  sigma_sd <- if (is.null(fit$sd$sigma.lv)) {
    rep(0, nrow(loadings))
  } else {
    rep(fit$sd$sigma.lv, length.out = nrow(loadings))
  }
  sigma_sd[!is.finite(sigma_sd)] <- 0
  variances <- sweep(theta_sd^2, 2L, sigma^2, "*") +
    sweep(theta^2, 2L, sigma_sd^2, "*")
  variances <- t(variances)
  variances[!is.finite(variances) | variances <= 0] <- fallback
  as.vector(t(variances))
}

extract_uncertainty <- function(beta, loadings, beta_covariance, loading_variances) {
  parameter_order <- c(
    unlist(lapply(seq_len(nrow(beta)), function(row) {
      paste0("Beta[", rownames(beta)[[row]], ",", colnames(beta), "]")
    })),
    unlist(lapply(seq_len(nrow(loadings)), function(row) {
      paste0("Lambda[LV", row, ",", colnames(loadings), "]")
    }))
  )
  diagonal <- c(diag(beta_covariance), loading_variances)
  list(
    kind = "sampling_covariance",
    parameterOrder = as.list(parameter_order),
    covariance = list(
      representation = "diagonal",
      diagonal = as.list(unname(diagonal))
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
  draw_count <- 200L
  beta <- extract_beta(fit, translation)
  latent <- extract_latent_components(fit, translation)
  projection <- extract_projection(fit, translation)
  fixed_covariance <- extract_fixed_covariance(fit, beta)
  loading_variances <- extract_loading_variances(fit, latent$loadings)
  resampled <- with_resample_seed(translation$spec$seed, {
    predictive <- make_predictive_cloud(
      translation, beta, fixed_covariance$values, latent, loading_variances,
      projection, draw_count
    )
    list(
      predictive = predictive,
      metrics = make_tier_metrics(
        translation, beta, latent, projection, predictive, draw_count
      )
    )
  })
  response_features <- colnames(translation$prepared$y)
  warnings <- unique(c(
    translation$warnings,
    attr(fit, "metaspacer_warnings"),
    fixed_covariance$warning,
    paste0(
      "Intervals use ", draw_count,
      " deterministic bootstrap or asymptotic sampling draws."
    )
  ))

  list(
    bundleVersion = "1.0.0",
    specVersion = translation$spec$specVersion,
    precomputed = list(
      metrics = resampled$metrics,
      ordination = list(
        axisLabels = list("Space 1", "Space 2"),
        states = c(
          make_observed_states(translation, projection),
          resampled$predictive$states
        )
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
      uncertainty = extract_uncertainty(
        beta, latent$loadings, fixed_covariance$values, loading_variances
      )
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
