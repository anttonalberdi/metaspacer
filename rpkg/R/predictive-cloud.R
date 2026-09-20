focal_names_by_type <- function(entries, types) {
  vapply(Filter(function(entry) entry$type %in% types, entries), `[[`, character(1), "column")
}

condition_matches <- function(samples, rows, names, condition) {
  for (name in names) {
    rows <- rows & as.character(samples[[name]]) == as.character(condition[[name]])
  }
  rows
}

standardize_condition <- function(condition, names, encodings) {
  vapply(names, function(name) {
    encoding <- encodings[[which(vapply(
      encodings, function(item) identical(item$name, name), logical(1)
    ))]]
    (as.numeric(condition[[name]]) - encoding$center) / encoding$scale
  }, numeric(1))
}

standardize_samples <- function(samples, names, encodings) {
  output <- vapply(names, function(name) {
    encoding <- encodings[[which(vapply(
      encodings, function(item) identical(item$name, name), logical(1)
    ))]]
    (as.numeric(samples[[name]]) - encoding$center) / encoding$scale
  }, numeric(nrow(samples)))
  matrix(output, nrow = nrow(samples), dimnames = list(NULL, names))
}

distance_to_segment <- function(point, start, end) {
  difference <- end - start
  denominator <- sum(difference^2)
  if (denominator <= .Machine$double.eps) {
    return(sqrt(sum((point - start)^2)))
  }
  position <- max(0, min(1, sum((point - start) * difference) / denominator))
  sqrt(sum((point - (start + position * difference))^2))
}

point_in_polygon <- function(point, polygon) {
  if (nrow(polygon) < 3L) {
    return(FALSE)
  }
  following <- c(seq.int(2L, nrow(polygon)), 1L)
  boundary <- vapply(seq_len(nrow(polygon)), function(index) {
    distance_to_segment(point, polygon[index, ], polygon[following[[index]], ]) < 1e-10
  }, logical(1))
  if (any(boundary)) {
    return(TRUE)
  }
  crossings <- ((polygon[, 2L] > point[[2L]]) != (polygon[following, 2L] > point[[2L]])) &
    (point[[1L]] < (polygon[following, 1L] - polygon[, 1L]) *
       (point[[2L]] - polygon[, 2L]) /
       (polygon[following, 2L] - polygon[, 2L]) + polygon[, 1L])
  sum(crossings) %% 2L == 1L
}

classify_continuous_domain <- function(point, observed) {
  dimensions <- ncol(observed)
  if (dimensions == 1L) {
    limits <- range(observed[, 1L])
    distance <- max(limits[[1L]] - point[[1L]], point[[1L]] - limits[[2L]], 0)
    return(c(inside = distance <= 1e-10, distance = distance))
  }
  if (dimensions == 2L && nrow(unique(observed)) >= 3L) {
    hull <- observed[grDevices::chull(observed), , drop = FALSE]
    inside <- point_in_polygon(point, hull)
    following <- c(seq.int(2L, nrow(hull)), 1L)
    distance <- min(vapply(seq_len(nrow(hull)), function(index) {
      distance_to_segment(point, hull[index, ], hull[following[[index]], ])
    }, numeric(1)))
    return(c(inside = inside, distance = if (inside) 0 else distance))
  }
  lower <- apply(observed, 2L, min)
  upper <- apply(observed, 2L, max)
  excess <- pmax(lower - point, point - upper, 0)
  c(inside = all(excess <= 1e-10), distance = sqrt(sum(excess^2)))
}

classify_condition_domain <- function(condition, samples, entries, encodings) {
  discrete <- focal_names_by_type(entries, c("categorical", "binary"))
  continuous <- focal_names_by_type(entries, "continuous")
  rows <- condition_matches(samples, rep(TRUE, nrow(samples)), discrete, condition)
  if (!any(rows)) {
    return(list(
      method = "mixed_hull_range", insideSampledDomain = FALSE,
      distanceToDomain = 1
    ))
  }
  if (length(continuous) == 0L) {
    return(list(
      method = "mixed_hull_range", insideSampledDomain = TRUE,
      distanceToDomain = 0
    ))
  }
  point <- standardize_condition(condition, continuous, encodings)
  observed <- standardize_samples(samples[rows, , drop = FALSE], continuous, encodings)
  classification <- classify_continuous_domain(point, observed)
  list(
    method = "mixed_hull_range",
    insideSampledDomain = isTRUE(classification[["inside"]] > 0),
    distanceToDomain = unname(max(0, classification[["distance"]]))
  )
}

condition_from_row <- function(samples, index, entries) {
  output <- list()
  for (entry in entries) {
    output[[entry$column]] <- scalar_json_value(samples[[entry$column]][[index]])
  }
  output
}

condition_group <- function(condition, group_info) {
  if (is.null(group_info$column)) group_info$reference else as.character(
    condition[[group_info$column]]
  )
}

condition_identifier <- function(prefix, group, index) {
  label <- gsub("[^a-z0-9]+", "-", tolower(group))
  paste(prefix, label, index, sep = "-")
}

focal_strata <- function(samples, entries) {
  discrete <- focal_names_by_type(entries, c("categorical", "binary"))
  if (length(discrete) == 0L) {
    return(list(all = seq_len(nrow(samples))))
  }
  key <- interaction(samples[discrete], drop = TRUE, lex.order = TRUE)
  split(seq_len(nrow(samples)), key)
}

select_inside_rows <- function(rows, samples, entries, maximum = 8L) {
  continuous <- focal_names_by_type(entries, "continuous")
  if (length(continuous) > 0L) {
    rows <- rows[order(samples[[continuous[[1L]]]][rows])]
  }
  positions <- unique(round(seq(1, length(rows), length.out = min(maximum, length(rows)))))
  rows[positions]
}

make_inside_conditions <- function(translation) {
  samples <- translation$prepared$samples
  entries <- translation$spec$roles$samples$focalVariables
  group_info <- reference_group(translation)
  selected <- unlist(lapply(focal_strata(samples, entries), function(rows) {
    select_inside_rows(rows, samples, entries)
  }))
  lapply(seq_along(selected), function(index) {
    condition <- condition_from_row(samples, selected[[index]], entries)
    group <- condition_group(condition, group_info)
    list(
      state_id = condition_identifier("predicted", group, index),
      group = group, condition = condition,
      geometry = classify_condition_domain(
        condition, samples, entries, translation$prepared$predictor_encodings
      )
    )
  })
}

make_outside_condition <- function(rows, samples, entries, continuous, fraction) {
  anchor_index <- rows[[which.max(samples[[continuous]][rows])]]
  condition <- condition_from_row(samples, anchor_index, entries)
  observed_range <- diff(range(samples[[continuous]]))
  if (!is.finite(observed_range) || observed_range <= 0) {
    observed_range <- 1
  }
  condition[[continuous]] <- max(samples[[continuous]][rows]) + fraction * observed_range
  condition
}

make_outside_conditions <- function(translation) {
  samples <- translation$prepared$samples
  entries <- translation$spec$roles$samples$focalVariables
  continuous <- focal_names_by_type(entries, "continuous")
  if (length(continuous) == 0L) {
    return(list())
  }
  group_info <- reference_group(translation)
  output <- list()
  for (rows in focal_strata(samples, entries)) {
    for (fraction in c(0.1, 0.25, 0.5)) {
      condition <- make_outside_condition(rows, samples, entries, continuous[[1L]], fraction)
      group <- condition_group(condition, group_info)
      output[[length(output) + 1L]] <- list(
        state_id = condition_identifier("extrapolated", group, length(output) + 1L),
        group = group, condition = condition,
        geometry = classify_condition_domain(
          condition, samples, entries, translation$prepared$predictor_encodings
        )
      )
    }
  }
  output
}

make_prediction_conditions <- function(translation) {
  c(make_inside_conditions(translation), make_outside_conditions(translation))
}

conditions_data_frame <- function(conditions, entries) {
  values <- lapply(conditions, `[[`, "condition")
  output <- data.frame(row.names = seq_along(values))
  for (entry in entries) {
    if (identical(entry$type, "continuous")) {
      output[[entry$column]] <- vapply(values, function(value) {
        as.numeric(value[[entry$column]])
      }, numeric(1))
    } else {
      output[[entry$column]] <- vapply(values, function(value) {
        as.character(scalar_json_value(value[[entry$column]]))
      }, character(1))
    }
  }
  output
}

encode_conditions <- function(conditions, translation) {
  entries <- translation$spec$roles$samples$focalVariables
  raw <- conditions_data_frame(conditions, entries)
  encoded <- data.frame(row.names = seq_len(nrow(raw)))
  for (encoding in translation$prepared$predictor_encodings) {
    values <- raw[[encoding$name]]
    if (identical(encoding$type, "categorical")) {
      encoded[[encoding$name]] <- factor(values, levels = unlist(encoding$levels))
    } else if (identical(encoding$type, "continuous")) {
      encoded[[encoding$name]] <- (values - encoding$center) / encoding$scale
    } else {
      encoded[[encoding$name]] <- as.integer(
        as.character(values) == as.character(encoding$trueValue)
      )
    }
  }
  stats::model.matrix(translation$design_formula, data = encoded)
}

sample_multivariate_normal <- function(mean, covariance, draw_count) {
  if (length(mean) == 0L) {
    return(matrix(numeric(), nrow = draw_count, ncol = 0L))
  }
  covariance <- (covariance + t(covariance)) / 2
  decomposition <- eigen(covariance, symmetric = TRUE)
  values <- pmax(decomposition$values, 0)
  factor <- sweep(decomposition$vectors, 2L, sqrt(values), "*")
  noise <- matrix(stats::rnorm(draw_count * length(mean)), nrow = draw_count)
  sweep(noise %*% t(factor), 2L, mean, "+")
}

sample_independent_normal <- function(mean, variances, draw_count) {
  if (length(mean) == 0L) {
    return(matrix(numeric(), nrow = draw_count, ncol = 0L))
  }
  noise <- matrix(stats::rnorm(draw_count * length(mean)), nrow = draw_count)
  sweep(noise, 2L, sqrt(pmax(variances, 0)), "*") +
    matrix(mean, nrow = draw_count, ncol = length(mean), byrow = TRUE)
}

predict_coordinate_draws <- function(design, beta, beta_covariance, latent,
                                     loading_variances, projection, draw_count) {
  beta_mean <- as.vector(t(beta))
  beta_draws <- sample_multivariate_normal(beta_mean, beta_covariance, draw_count)
  loading_draws <- sample_independent_normal(
    as.vector(t(latent$loadings)), loading_variances, draw_count
  )
  latent_draws <- sample_multivariate_normal(
    latent$mean, latent$covariance, draw_count * nrow(design)
  )
  fixed <- array(0, dim = c(nrow(design), 2L, draw_count))
  cloud <- fixed
  for (draw in seq_len(draw_count)) {
    beta_matrix <- matrix(beta_draws[draw, ], nrow = nrow(beta), byrow = TRUE)
    loadings <- matrix(
      loading_draws[draw, ], nrow = nrow(latent$loadings), byrow = TRUE
    )
    fixed_eta <- design %*% beta_matrix
    fixed_eta <- sweep(fixed_eta, 2L, as.numeric(latent$mean %*% loadings), "+")
    draw_rows <- seq.int((draw - 1L) * nrow(design) + 1L, draw * nrow(design))
    cloud_eta <- fixed_eta + latent_draws[draw_rows, , drop = FALSE] %*% loadings
    fixed[, , draw] <- sweep(fixed_eta, 2L, projection$center, "-") %*% projection$rotation
    cloud[, , draw] <- sweep(cloud_eta, 2L, projection$center, "-") %*% projection$rotation
  }
  list(beta = beta_draws, loadings = loading_draws, fixed = fixed, cloud = cloud)
}

make_predicted_state <- function(condition, coordinate_draws) {
  tier <- if (condition$geometry$insideSampledDomain) "interpolated" else "extrapolated"
  coordinates <- lapply(seq_len(2L), function(axis) {
    list(
      axis = paste("Space", axis),
      estimate = interval_estimate(coordinate_draws[axis, ], "confidence")
    )
  })
  list(
    stateId = condition$state_id,
    kind = "predicted",
    group = condition$group,
    condition = condition$condition,
    tier = tier,
    coordinates = coordinates,
    geometry = condition$geometry
  )
}

make_predictive_cloud <- function(translation, beta, beta_covariance, latent,
                                  loading_variances, projection, draw_count) {
  conditions <- make_prediction_conditions(translation)
  design <- encode_conditions(conditions, translation)
  draws <- predict_coordinate_draws(
    design, beta, beta_covariance, latent, loading_variances, projection, draw_count
  )
  states <- lapply(seq_along(conditions), function(index) {
    make_predicted_state(conditions[[index]], draws$cloud[index, , ])
  })
  list(conditions = conditions, design = design, draws = draws, states = states)
}

coordinate_centroid <- function(coordinates, rows, draw) {
  values <- coordinates[rows, , draw, drop = FALSE]
  values <- matrix(values, nrow = length(rows), ncol = 2L)
  colMeans(values)
}

transition_draws <- function(predictive, from_rows, to_rows) {
  vapply(seq_len(dim(predictive$draws$fixed)[[3L]]), function(draw) {
    metric_transition(
      coordinate_centroid(predictive$draws$fixed, from_rows, draw),
      coordinate_centroid(predictive$draws$fixed, to_rows, draw)
    )
  }, numeric(1))
}

make_transition_metrics <- function(translation, predictive) {
  group_info <- reference_group(translation)
  inside <- vapply(predictive$conditions, function(item) {
    item$geometry$insideSampledDomain
  }, logical(1))
  groups <- vapply(predictive$conditions, `[[`, character(1), "group")
  alternatives <- setdiff(unique(groups[inside]), group_info$reference)
  if (length(alternatives) == 0L) {
    rows <- which(inside)
    midpoint <- max(1L, floor(length(rows) / 2L))
    alternatives <- "condition-space endpoint"
    from_rows <- rows[seq_len(midpoint)]
    to_rows <- rows[seq.int(midpoint + 1L, length(rows))]
    if (length(to_rows) == 0L) to_rows <- from_rows
    return(list(new_metric(
      "transition_distance", "Condition-space transition", "interpolated",
      transition_draws(predictive, from_rows, to_rows), "ordination_distance",
      list(from = "lower", to = "upper"), c(0, Inf)
    )))
  }
  lapply(alternatives, function(comparison) {
    new_metric(
      "transition_distance", paste0(group_info$reference, " to ", comparison, " transition"),
      "interpolated", transition_draws(
        predictive, which(inside & groups == group_info$reference),
        which(inside & groups == comparison)
      ), "ordination_distance", list(from = group_info$reference, to = comparison), c(0, Inf)
    )
  })
}

coordinate_slope <- function(x, coordinates) {
  centered <- x - mean(x)
  denominator <- sum(centered^2)
  if (length(x) < 2L || denominator <= .Machine$double.eps) {
    return(0)
  }
  slopes <- as.numeric(crossprod(centered, coordinates)) / denominator
  sqrt(sum(slopes^2))
}

plasticity_draws <- function(predictive, rows, condition_name) {
  x <- vapply(predictive$conditions[rows], function(item) {
    as.numeric(item$condition[[condition_name]])
  }, numeric(1))
  vapply(seq_len(dim(predictive$draws$fixed)[[3L]]), function(draw) {
    coordinate_slope(x, predictive$draws$fixed[rows, , draw, drop = FALSE][, , 1L])
  }, numeric(1))
}

make_plasticity_metrics <- function(translation, predictive) {
  entries <- translation$spec$roles$samples$focalVariables
  continuous <- focal_names_by_type(entries, "continuous")
  if (length(continuous) == 0L) {
    transitions <- make_transition_metrics(translation, predictive)
    values <- transitions[[1L]]$estimate$median
    return(list(new_metric(
      "plasticity", "Relative condition response", "interpolated", values,
      "relative_distance", list(condition = "categorical_shift"), c(0, Inf)
    )))
  }
  condition_name <- continuous[[1L]]
  groups <- vapply(predictive$conditions, `[[`, character(1), "group")
  inside <- vapply(
    predictive$conditions,
    function(item) item$geometry$insideSampledDomain,
    logical(1)
  )
  output <- lapply(unique(groups), function(group) {
    rows <- which(groups == group & inside)
    new_metric(
      "plasticity", paste0(group, " predicted ", condition_name, " response"),
      "interpolated", plasticity_draws(predictive, rows, condition_name), "slope",
      list(group = group, condition = condition_name), c(0, Inf)
    )
  })
  outside <- which(!inside)
  if (length(outside) > 0L) {
    group <- groups[outside[[1L]]]
    rows <- which(groups == group)
    output[[length(output) + 1L]] <- new_metric(
      "plasticity", paste0("Beyond-range ", condition_name, " response"),
      "extrapolated", plasticity_draws(predictive, rows, condition_name), "slope",
      list(group = group, condition = condition_name, scenario = "beyond_observed_range"),
      c(0, Inf), "An fMS proxy; interpretation is limited beyond sampled conditions."
    )
  }
  output
}

variance_partition_draws <- function(translation, beta, latent, beta_draws, loading_draws) {
  vapply(seq_len(nrow(beta_draws)), function(draw) {
    beta_matrix <- matrix(beta_draws[draw, ], nrow = nrow(beta), byrow = TRUE)
    loadings <- matrix(
      loading_draws[draw, ], nrow = nrow(latent$loadings), byrow = TRUE
    )
    components <- metric_variance_partition(
      translation$design$matrix %*% beta_matrix, latent$scores %*% loadings
    )
    components
  }, numeric(2))
}

make_variance_metrics <- function(translation, beta, latent, predictive) {
  draws <- variance_partition_draws(
    translation, beta, latent, predictive$draws$beta, predictive$draws$loadings
  )
  list(
    new_metric(
      "variance_partition", "Actionable variance", "interpolated",
      draws["actionable", ], "proportion", list(component = "actionable"), c(0, 1)
    ),
    new_metric(
      "variance_partition", "Structural variance", "interpolated",
      draws["structural", ], "proportion", list(component = "structural"), c(0, 1)
    )
  )
}

make_tier_metrics <- function(translation, beta, latent, projection, predictive,
                              draw_count) {
  c(
    make_measured_metrics(translation, projection, draw_count),
    make_transition_metrics(translation, predictive),
    make_plasticity_metrics(translation, predictive),
    make_variance_metrics(translation, beta, latent, predictive)
  )
}
