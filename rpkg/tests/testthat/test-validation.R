test_that("the package exposes one public entry point", {
  expect_setequal(getNamespaceExports("metaspacer"), "run_spec")
})

test_that("validation reports structured ID mismatch details", {
  directory <- withr::local_tempdir()
  fixture <- make_test_fixture(directory)
  spec <- metaspacer:::read_model_spec(fixture$spec_path)
  loaded <- metaspacer:::load_spec_data(spec, directory)$data
  loaded$sample_metadata <- loaded$sample_metadata[-1L, , drop = FALSE]
  engine <- metaspacer:::new_engine("gllvm")

  result <- metaspacer:::engine_validate(engine, spec, loaded)

  expect_false(result$valid)
  mismatch <- Filter(
    function(issue) identical(issue$code, "sample_id_mismatch"),
    result$errors
  )
  expect_length(mismatch, 1L)
  expect_match(mismatch[[1L]]$message, "23/24")
  expect_identical(mismatch[[1L]]$details$missingFromMetadata, "S001")
})

test_that("cost estimation is cheap and dimension-aware", {
  directory <- withr::local_tempdir()
  fixture <- make_test_fixture(directory)
  spec <- metaspacer:::read_model_spec(fixture$spec_path)
  loaded <- metaspacer:::load_spec_data(spec, directory)$data
  engine <- metaspacer:::new_engine("gllvm")

  estimate <- metaspacer:::engine_estimate_cost(engine, spec, loaded)

  expect_identical(estimate$samples, 24L)
  expect_identical(estimate$responses, 6L)
  expect_identical(estimate$latentVariables, 1L)
  expect_gte(estimate$estimatedMemoryMB, 1)
  expect_gte(estimate$estimatedRuntimeSeconds$upper, estimate$estimatedRuntimeSeconds$lower)
})

test_that("builder preflight composes package validation and cost estimation", {
  directory <- withr::local_tempdir()
  fixture <- make_test_fixture(directory)

  result <- metaspacer:::preflight_spec(fixture$spec_path, directory)

  expect_true(result$validation$valid)
  expect_empty(result$validation$errors)
  expect_identical(result$cost$samples, 24L)
  expect_identical(result$cost$responses, 6L)

  fixture$spec$roles$samples$sampleIdColumn <- "unknown_id"
  jsonlite::write_json(
    fixture$spec,
    fixture$spec_path,
    auto_unbox = TRUE,
    pretty = TRUE,
    null = "null"
  )
  invalid <- metaspacer:::preflight_spec(fixture$spec_path, directory)

  expect_false(invalid$validation$valid)
  expect_null(invalid$cost)
  expect_true(any(vapply(
    invalid$validation$errors,
    function(issue) identical(issue$code, "missing_sample_id_column"),
    logical(1)
  )))
})
