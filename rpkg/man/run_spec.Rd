\name{run_spec}
\alias{run_spec}
\title{Run a metaspacer model specification}
\usage{
run_spec(spec_path, data_dir = dirname(spec_path), out_path = NULL)
}
\arguments{
\item{spec_path}{Path to a model-spec JSON document.}
\item{data_dir}{Directory against which the spec's data paths are resolved.}
\item{out_path}{Output directory or JSON file. When omitted, the spec's output path is used.}
}
\value{The normalized path to the written results-bundle JSON file, invisibly.}
\description{
Validates the model specification and its referenced data, translates it to
the selected engine, fits it, and atomically writes a results bundle.
}
