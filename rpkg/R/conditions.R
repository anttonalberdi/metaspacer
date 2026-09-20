validation_issue <- function(code, path, message, details = list()) {
  list(
    code = code,
    path = path,
    message = message,
    details = details
  )
}

validation_result <- function(errors = list(), warnings = list()) {
  structure(
    list(
      valid = length(errors) == 0L,
      errors = errors,
      warnings = warnings
    ),
    class = "metaspacer_validation_result"
  )
}

abort_validation <- function(result) {
  messages <- vapply(
    result$errors,
    function(issue) paste0(issue$path, ": ", issue$message),
    character(1)
  )
  condition <- structure(
    list(
      message = paste(c("Model specification validation failed:", messages), collapse = "\n- "),
      call = NULL,
      issues = result$errors
    ),
    class = c("metaspacer_validation_error", "error", "condition")
  )
  stop(condition)
}

abort_metaspacer <- function(message, class = "metaspacer_error", ...) {
  condition <- structure(
    list(message = message, call = NULL, ...),
    class = c(class, "metaspacer_error", "error", "condition")
  )
  stop(condition)
}
