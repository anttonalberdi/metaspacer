read_model_spec <- function(spec_path) {
  if (!is.character(spec_path) || length(spec_path) != 1L || !file.exists(spec_path)) {
    abort_metaspacer(
      paste0("Model spec does not exist: ", spec_path),
      "metaspacer_input_error"
    )
  }

  tryCatch(
    jsonlite::read_json(spec_path, simplifyVector = FALSE),
    error = function(error) {
      abort_metaspacer(
        paste0("Could not parse model spec JSON: ", conditionMessage(error)),
        "metaspacer_input_error"
      )
    }
  )
}

validate_spec_document <- function(spec) {
  errors <- list()
  add_error <- function(code, path, message, details = list()) {
    errors[[length(errors) + 1L]] <<- validation_issue(code, path, message, details)
  }

  if (!identical(spec$specVersion, "1.0.0")) {
    add_error("unsupported_spec_version", "/specVersion", "Expected specVersion 1.0.0.")
  }
  if (!identical(spec$engine, "gllvm")) {
    add_error("unsupported_engine", "/engine", "M2 supports the gllvm engine only.")
  }
  if (is.null(spec$data) || is.null(spec$roles) || is.null(spec$model)) {
    add_error(
      "missing_required_section",
      "/",
      "The data, roles, and model sections are required."
    )
  }
  if (is.null(spec$resources$cpuThreads) || spec$resources$cpuThreads < 1) {
    add_error("invalid_cpu_threads", "/resources/cpuThreads", "cpuThreads must be positive.")
  }
  if (is.null(spec$seed) || spec$seed < 0) {
    add_error("invalid_seed", "/seed", "seed must be a non-negative integer.")
  }

  validation_result(errors)
}

is_safe_relative_path <- function(path) {
  is.character(path) &&
    length(path) == 1L &&
    nzchar(path) &&
    !startsWith(path, "/") &&
    !grepl("(^|[/\\\\])\\.\\.([/\\\\]|$)", path)
}

resolve_data_path <- function(data_dir, relative_path) {
  if (!is_safe_relative_path(relative_path)) {
    return(NULL)
  }

  base <- normalizePath(data_dir, mustWork = TRUE)
  candidate <- normalizePath(file.path(base, relative_path), mustWork = FALSE)
  prefix <- paste0(base, .Platform$file.sep)
  if (!identical(candidate, base) && !startsWith(candidate, prefix)) {
    return(NULL)
  }
  candidate
}

read_table_reference <- function(reference, path) {
  format <- reference$format
  if (!format %in% c("csv", "tsv")) {
    abort_metaspacer(
      paste0("M2 supports CSV and TSV tables; received ", format, "."),
      "metaspacer_input_error"
    )
  }
  separator <- if (identical(format, "tsv")) "\t" else ","
  utils::read.table(
    path,
    header = TRUE,
    sep = separator,
    check.names = FALSE,
    stringsAsFactors = FALSE,
    comment.char = "",
    quote = "\""
  )
}

load_spec_data <- function(spec, data_dir) {
  references <- spec$data
  required <- c("countTable", "sampleMetadata", "featureMetadata")
  errors <- list()
  paths <- list()
  hashes <- list()

  for (name in c(required, "phylogeneticTree")) {
    reference <- references[[name]]
    if (is.null(reference)) {
      if (name %in% required) {
        errors[[length(errors) + 1L]] <- validation_issue(
          "missing_data_reference",
          paste0("/data/", name),
          paste0("Missing required ", name, " reference.")
        )
      }
      next
    }

    resolved <- resolve_data_path(data_dir, reference$path)
    if (is.null(resolved)) {
      errors[[length(errors) + 1L]] <- validation_issue(
        "unsafe_data_path",
        paste0("/data/", name, "/path"),
        "Data paths must stay within data_dir."
      )
      next
    }
    if (!file.exists(resolved)) {
      errors[[length(errors) + 1L]] <- validation_issue(
        "missing_data_file",
        paste0("/data/", name, "/path"),
        paste0("Referenced file does not exist: ", reference$path)
      )
      next
    }

    actual_hash <- digest::digest(
      file = resolved,
      algo = "sha256",
      serialize = FALSE
    )
    if (!identical(actual_hash, reference$sha256)) {
      errors[[length(errors) + 1L]] <- validation_issue(
        "data_hash_mismatch",
        paste0("/data/", name, "/sha256"),
        paste0("SHA-256 mismatch for ", reference$path, "."),
        list(expected = reference$sha256, actual = actual_hash)
      )
      next
    }

    paths[[name]] <- resolved
    hashes[[name]] <- actual_hash
  }

  if (length(errors) > 0L) {
    return(list(validation = validation_result(errors), data = NULL))
  }

  loaded <- list(
    count_table = read_table_reference(references$countTable, paths$countTable),
    sample_metadata = read_table_reference(
      references$sampleMetadata,
      paths$sampleMetadata
    ),
    feature_metadata = read_table_reference(
      references$featureMetadata,
      paths$featureMetadata
    ),
    tree = NULL,
    paths = paths,
    hashes = hashes
  )
  if (!is.null(paths$phylogeneticTree)) {
    loaded$tree <- ape::read.tree(paths$phylogeneticTree)
  }

  list(validation = validation_result(), data = loaded)
}

named_entries <- function(entries, field) {
  if (length(entries) == 0L) {
    return(character())
  }
  vapply(entries, `[[`, character(1), field)
}

scalar_json_value <- function(value) {
  if (is.factor(value)) {
    return(as.character(value))
  }
  if (is.integer(value)) {
    return(as.integer(value))
  }
  if (is.numeric(value)) {
    return(as.numeric(value))
  }
  if (is.logical(value)) {
    return(as.logical(value))
  }
  as.character(value)
}
