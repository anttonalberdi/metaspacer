test_that("run_spec fits a negative-binomial example and writes a bundle", {
  directory <- withr::local_tempdir()
  fixture <- make_test_fixture(directory)
  output <- file.path(directory, "result")

  path <- run_spec(fixture$spec_path, directory, output)
  bundle <- jsonlite::read_json(path, simplifyVector = FALSE)

  expect_true(file.exists(path))
  expect_identical(bundle$bundleVersion, "1.0.0")
  expect_identical(bundle$provenance$engine$name, "gllvm")
  expect_true(
    utils::compareVersion(bundle$provenance$engine$version, "2.0.0") >= 0
  )
  expect_identical(bundle$fittedParameters$dimensions$responses, 6L)
  expect_identical(bundle$fittedParameters$dimensions$coefficients, 3L)
  expect_identical(bundle$fittedParameters$dimensions$latentVariables, 1L)
  expect_setequal(
    unique(vapply(bundle$precomputed$metrics, `[[`, character(1), "id")),
    c(
      "dispersion", "effective_dimensionality", "schoener_d", "containment",
      "transition_distance", "plasticity", "variance_partition", "chao_coverage"
    )
  )
  expect_gt(length(bundle$precomputed$ordination$states), 24L)
  expect_setequal(
    unique(vapply(bundle$precomputed$ordination$states, `[[`, character(1), "tier")),
    c("measured", "interpolated", "extrapolated")
  )
})

test_that("M3 metrics carry resampled intervals and coherent confidence tiers", {
  directory <- withr::local_tempdir()
  fixture <- make_test_fixture(directory)
  output <- file.path(directory, "result")
  path <- run_spec(fixture$spec_path, directory, output)
  bundle <- jsonlite::read_json(path, simplifyVector = FALSE)
  metrics <- bundle$precomputed$metrics

  for (metric in metrics) {
    expect_lte(metric$estimate$lower, metric$estimate$median, label = metric$label)
    expect_lte(metric$estimate$median, metric$estimate$upper, label = metric$label)
    expected_type <- if (identical(metric$tier, "measured")) "bootstrap" else "confidence"
    expect_identical(metric$estimate$intervalType, expected_type, label = metric$label)
  }
  expect_true(any(vapply(metrics, function(metric) metric$tier == "extrapolated", logical(1))))

  states <- bundle$precomputed$ordination$states
  for (state in states) {
    expect_identical(
      state$geometry$insideSampledDomain,
      !identical(state$tier, "extrapolated"),
      label = state$stateId
    )
  }

  dimensions <- bundle$fittedParameters$dimensions
  uncertainty <- bundle$fittedParameters$uncertainty
  expected_parameters <- dimensions$coefficients * dimensions$responses +
    dimensions$latentVariables * dimensions$responses
  expect_length(uncertainty$parameterOrder, expected_parameters)
  expect_length(uncertainty$covariance$diagonal, expected_parameters)
  expect_true(all(unlist(uncertainty$covariance$diagonal) > 0))
})
