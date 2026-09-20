new_engine <- function(name) {
  if (!identical(name, "gllvm")) {
    abort_metaspacer(
      paste0("No engine implementation is available for '", name, "'."),
      "metaspacer_engine_error"
    )
  }
  structure(list(name = name), class = c("metaspacer_engine_gllvm", "metaspacer_engine"))
}

engine_validate <- function(engine, spec, data) {
  UseMethod("engine_validate")
}

engine_estimate_cost <- function(engine, spec, data) {
  UseMethod("engine_estimate_cost")
}

engine_translate <- function(engine, spec, data) {
  UseMethod("engine_translate")
}

engine_fit <- function(engine, translation) {
  UseMethod("engine_fit")
}

engine_extract <- function(engine, fit, translation, context) {
  UseMethod("engine_extract")
}

merge_validation_results <- function(...) {
  results <- list(...)
  validation_result(
    errors = unlist(lapply(results, `[[`, "errors"), recursive = FALSE),
    warnings = unlist(lapply(results, `[[`, "warnings"), recursive = FALSE)
  )
}
