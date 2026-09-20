test_that("geometric tiers flip at the sampled condition boundary", {
  directory <- withr::local_tempdir()
  fixture <- make_test_fixture(directory)
  spec <- metaspacer:::read_model_spec(fixture$spec_path)
  loaded <- metaspacer:::load_spec_data(spec, directory)$data
  engine <- metaspacer:::new_engine("gllvm")
  translation <- metaspacer:::engine_translate(engine, spec, loaded)
  samples <- translation$prepared$samples
  entries <- spec$roles$samples$focalVariables
  encodings <- translation$prepared$predictor_encodings

  inside <- metaspacer:::classify_condition_domain(
    list(group = "Reference", habitat_score = -0.5), samples, entries, encodings
  )
  outside <- metaspacer:::classify_condition_domain(
    list(group = "Reference", habitat_score = 2), samples, entries, encodings
  )
  unseen <- metaspacer:::classify_condition_domain(
    list(group = "Unsampled", habitat_score = 0), samples, entries, encodings
  )

  expect_true(inside$insideSampledDomain)
  expect_equal(inside$distanceToDomain, 0)
  expect_false(outside$insideSampledDomain)
  expect_gt(outside$distanceToDomain, 0)
  expect_false(unseen$insideSampledDomain)
  expect_gt(unseen$distanceToDomain, 0)
})

test_that("two continuous focal variables use their sampled convex hull", {
  samples <- data.frame(x = c(0, 1, 0), y = c(0, 0, 1))
  entries <- list(
    list(column = "x", type = "continuous"),
    list(column = "y", type = "continuous")
  )
  encodings <- list(
    list(name = "x", type = "continuous", center = 0, scale = 1),
    list(name = "y", type = "continuous", center = 0, scale = 1)
  )

  inside <- metaspacer:::classify_condition_domain(
    list(x = 0.2, y = 0.2), samples, entries, encodings
  )
  outside <- metaspacer:::classify_condition_domain(
    list(x = 0.8, y = 0.8), samples, entries, encodings
  )

  expect_true(inside$insideSampledDomain)
  expect_equal(inside$distanceToDomain, 0)
  expect_false(outside$insideSampledDomain)
  expect_gt(outside$distanceToDomain, 0)
})

test_that("resampling preserves the caller's random-number stream", {
  set.seed(19)
  before <- .Random.seed
  value <- metaspacer:::with_resample_seed(731, stats::runif(3))

  expect_length(value, 3L)
  expect_identical(.Random.seed, before)
})
