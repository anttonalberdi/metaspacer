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
