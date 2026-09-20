resolve_output_file <- function(spec, spec_path, out_path) {
  requested <- out_path
  if (is.null(requested)) {
    requested <- spec$output$path
    if (!grepl("^/", requested)) {
      requested <- file.path(dirname(normalizePath(spec_path)), requested)
    }
  }
  requested <- path.expand(requested)
  if (tolower(tools::file_ext(requested)) == "json") {
    return(requested)
  }
  file.path(requested, "results-bundle.json")
}

write_bundle_atomic <- function(bundle, output_file, overwrite) {
  output_directory <- dirname(output_file)
  if (!dir.exists(output_directory)) {
    if (!dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)) {
      abort_metaspacer(
        paste0("Could not create output directory: ", output_directory),
        "metaspacer_output_error"
      )
    }
  }
  if (file.exists(output_file) && !isTRUE(overwrite)) {
    abort_metaspacer(
      paste0("Output already exists and overwrite is false: ", output_file),
      "metaspacer_output_error"
    )
  }

  temporary <- tempfile("results-bundle-", tmpdir = output_directory, fileext = ".json")
  on.exit(unlink(temporary), add = TRUE)
  jsonlite::write_json(
    bundle,
    temporary,
    auto_unbox = TRUE,
    pretty = TRUE,
    digits = NA,
    null = "null"
  )
  if (suppressWarnings(file.rename(temporary, output_file))) {
    return(normalizePath(output_file))
  }

  backup <- tempfile("previous-bundle-", tmpdir = output_directory, fileext = ".json")
  if (!file.rename(output_file, backup)) {
    abort_metaspacer(
      paste0("Could not safely replace output file: ", output_file),
      "metaspacer_output_error"
    )
  }
  if (!file.rename(temporary, output_file)) {
    file.rename(backup, output_file)
    abort_metaspacer(
      paste0("Could not move completed bundle to: ", output_file),
      "metaspacer_output_error"
    )
  }
  unlink(backup)
  normalizePath(output_file)
}

#' Run a metaspacer model specification
#'
#' @param spec_path Path to a model-spec JSON document.
#' @param data_dir Directory against which data references are resolved.
#' @param out_path Output directory or JSON file. Defaults to the spec output.
#'
#' @return The normalized output bundle path, invisibly.
#' @export
run_spec <- function(spec_path, data_dir = dirname(spec_path), out_path = NULL) {
  if (utils::packageVersion("gllvm") < "2.0.0") {
    abort_metaspacer("gllvm >= 2.0.0 is required.", "metaspacer_dependency_error")
  }
  spec <- read_model_spec(spec_path)
  document_validation <- validate_spec_document(spec)
  if (!document_validation$valid) {
    abort_validation(document_validation)
  }

  loaded <- load_spec_data(spec, data_dir)
  if (!loaded$validation$valid) {
    abort_validation(loaded$validation)
  }
  engine <- new_engine(spec$engine)
  engine_validation <- engine_validate(engine, spec, loaded$data)
  if (!engine_validation$valid) {
    abort_validation(engine_validation)
  }

  translation <- engine_translate(engine, spec, loaded$data)
  fit <- engine_fit(engine, translation)
  bundle <- engine_extract(
    engine,
    fit,
    translation,
    list(
      spec_hash = digest::digest(
        file = spec_path,
        algo = "sha256",
        serialize = FALSE
      ),
      data_hashes = loaded$data$hashes
    )
  )
  output_file <- resolve_output_file(spec, spec_path, out_path)
  written <- write_bundle_atomic(bundle, output_file, spec$output$overwrite)
  invisible(written)
}
