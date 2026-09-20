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
  expect_length(bundle$precomputed$metrics, 8L)
  expect_length(bundle$precomputed$ordination$states, 24L)
})
