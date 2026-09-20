with_resample_seed <- function(seed, code) {
  had_seed <- exists(".Random.seed", envir = .GlobalEnv, inherits = FALSE)
  if (had_seed) {
    previous_seed <- get(".Random.seed", envir = .GlobalEnv, inherits = FALSE)
  }
  on.exit({
    if (had_seed) {
      assign(".Random.seed", previous_seed, envir = .GlobalEnv) # nolint: object_name_linter.
    } else if (exists(".Random.seed", envir = .GlobalEnv, inherits = FALSE)) {
      rm(".Random.seed", envir = .GlobalEnv) # nolint: object_name_linter.
    }
  })
  set.seed(seed)
  force(code)
}

interval_estimate <- function(values, interval_type, bounds = c(-Inf, Inf)) {
  values <- values[is.finite(values)]
  if (length(values) == 0L) {
    values <- 0
  }
  quantiles <- stats::quantile(values, c(0.025, 0.5, 0.975), names = FALSE)
  list(
    median = unname(max(bounds[[1L]], min(bounds[[2L]], quantiles[[2L]]))),
    lower = unname(max(bounds[[1L]], quantiles[[1L]])),
    upper = unname(min(bounds[[2L]], quantiles[[3L]])),
    level = 0.95,
    intervalType = interval_type
  )
}

new_metric <- function(id, label, tier, values, unit, scope, bounds, note = NULL) {
  interval_type <- if (identical(tier, "measured")) "bootstrap" else "confidence"
  metric <- list(
    id = id,
    label = label,
    tier = tier,
    estimate = interval_estimate(values, interval_type, bounds),
    unit = unit,
    scope = scope
  )
  if (!is.null(note)) {
    metric$note <- note
  }
  metric
}

resample_rows <- function(row_count) {
  sample.int(row_count, row_count, replace = TRUE)
}

metric_dispersion <- function(scores) {
  if (nrow(scores) < 2L) {
    return(0)
  }
  center <- colMeans(scores)
  mean(sqrt(rowSums(sweep(scores, 2L, center, "-")^2)))
}

metric_effective_dimensionality <- function(values) {
  if (nrow(values) < 2L || ncol(values) < 1L) {
    return(0)
  }
  covariance <- stats::cov(values)
  if (length(covariance) == 1L) {
    eigenvalues <- max(0, covariance)
  } else {
    eigenvalues <- pmax(eigen(covariance, symmetric = TRUE, only.values = TRUE)$values, 0)
  }
  denominator <- sum(eigenvalues^2)
  if (denominator <= .Machine$double.eps) 0 else sum(eigenvalues)^2 / denominator
}

relative_composition <- function(values) {
  totals <- colSums(values)
  abundance <- sum(totals)
  if (abundance <= 0) {
    return(rep(0, length(totals)))
  }
  totals / abundance
}

metric_schoener <- function(reference_y, comparison_y) {
  reference <- relative_composition(reference_y)
  comparison <- relative_composition(comparison_y)
  max(0, min(1, 1 - 0.5 * sum(abs(reference - comparison))))
}

regularized_covariance <- function(values) {
  if (nrow(values) < 2L) {
    return(diag(1e-8, ncol(values)))
  }
  covariance <- stats::cov(values)
  scale <- mean(diag(covariance))
  ridge <- if (is.finite(scale) && scale > 0) scale * 1e-8 else 1e-8
  covariance + diag(ridge, ncol(values))
}

metric_containment <- function(container, contained) {
  if (nrow(contained) == 0L || nrow(container) < 2L) {
    return(0)
  }
  distances <- tryCatch(
    stats::mahalanobis(
      contained,
      center = colMeans(container),
      cov = regularized_covariance(container)
    ),
    error = function(error) rep(Inf, nrow(contained))
  )
  mean(distances <= stats::qchisq(0.95, df = ncol(container)))
}

metric_transition <- function(from, to) {
  sqrt(sum((from - to)^2))
}

metric_variance_partition <- function(actionable, structural) {
  component_variance <- c(
    actionable = sum(apply(actionable, 2L, stats::var)),
    structural = sum(apply(structural, 2L, stats::var))
  )
  component_variance[!is.finite(component_variance)] <- 0
  total <- sum(component_variance)
  if (total <= .Machine$double.eps) {
    return(c(actionable = 0, structural = 0))
  }
  component_variance / total
}

metric_chao_coverage <- function(y) {
  totals <- colSums(y)
  abundance <- sum(totals)
  if (abundance <= 0) {
    return(0)
  }
  singletons <- sum(totals == 1)
  doubletons <- sum(totals == 2)
  adjustment_denominator <- (abundance - 1) * singletons + 2 * doubletons
  adjustment <- if (adjustment_denominator <= 0) {
    1
  } else {
    (abundance - 1) * singletons / adjustment_denominator
  }
  max(0, min(1, 1 - (singletons / abundance) * adjustment))
}

bootstrap_one_group <- function(y, scores, response_values, draw_count) {
  vapply(seq_len(draw_count), function(draw) {
    rows <- resample_rows(nrow(y))
    c(
      dispersion = metric_dispersion(scores[rows, , drop = FALSE]),
      dimensionality = metric_effective_dimensionality(
        response_values[rows, , drop = FALSE]
      ),
      coverage = metric_chao_coverage(y[rows, , drop = FALSE])
    )
  }, numeric(3))
}

make_group_metrics <- function(group, y, scores, response_values, draw_count) {
  draws <- bootstrap_one_group(y, scores, response_values, draw_count)
  list(
    new_metric(
      "dispersion", paste0(group, " oscillation"), "measured",
      draws["dispersion", ], "ordination_distance", list(group = group), c(0, Inf)
    ),
    new_metric(
      "effective_dimensionality", paste0(group, " effective dimensionality"),
      "measured", draws["dimensionality", ], "dimensions", list(group = group),
      c(0, ncol(response_values))
    ),
    new_metric(
      "chao_coverage", paste0(group, " sample coverage"), "measured",
      draws["coverage", ], "proportion", list(group = group), c(0, 1)
    )
  )
}

bootstrap_pair <- function(reference_y, comparison_y, reference_scores,
                           comparison_scores, draw_count) {
  vapply(seq_len(draw_count), function(draw) {
    reference_rows <- resample_rows(nrow(reference_y))
    comparison_rows <- resample_rows(nrow(comparison_y))
    c(
      schoener = metric_schoener(
        reference_y[reference_rows, , drop = FALSE],
        comparison_y[comparison_rows, , drop = FALSE]
      ),
      containment = metric_containment(
        reference_scores[reference_rows, , drop = FALSE],
        comparison_scores[comparison_rows, , drop = FALSE]
      )
    )
  }, numeric(2))
}

make_pair_metrics <- function(reference, comparison, y, scores, groups, draw_count) {
  reference_rows <- groups == reference
  comparison_rows <- groups == comparison
  draws <- bootstrap_pair(
    y[reference_rows, , drop = FALSE], y[comparison_rows, , drop = FALSE],
    scores[reference_rows, , drop = FALSE], scores[comparison_rows, , drop = FALSE],
    draw_count
  )
  list(
    new_metric(
      "schoener_d", paste0(reference, "\u2013", comparison, " overlap"),
      "measured", draws["schoener", ], "proportion",
      list(from = reference, to = comparison), c(0, 1)
    ),
    new_metric(
      "containment", paste0(comparison, " within ", reference, " space"),
      "measured", draws["containment", ], "proportion",
      list(container = reference, contained = comparison), c(0, 1)
    )
  )
}

make_measured_metrics <- function(translation, projection, draw_count) {
  group_info <- reference_group(translation)
  groups <- observed_groups(translation, group_info)
  levels <- unique(groups)
  y <- translation$prepared$y
  output <- unlist(lapply(levels, function(group) {
    selected <- groups == group
    make_group_metrics(
      group, y[selected, , drop = FALSE], projection$observed_scores[selected, , drop = FALSE],
      projection$observed_eta[selected, , drop = FALSE], draw_count
    )
  }), recursive = FALSE)
  alternatives <- setdiff(levels, group_info$reference)
  if (length(alternatives) == 0L) {
    alternatives <- group_info$reference
  }
  pairs <- unlist(lapply(alternatives, function(comparison) {
    make_pair_metrics(
      group_info$reference, comparison, y, projection$observed_scores, groups, draw_count
    )
  }), recursive = FALSE)
  c(output, pairs)
}
