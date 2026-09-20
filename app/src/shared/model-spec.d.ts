/* Generated from schemas/. Do not edit directly; run `pnpm generate:types`. */

/**
 * A portable, declarative recipe for one metaspacer model run.
 */
export type ModelSpec = {
  /**
   * Version of the model-spec contract, not the application version.
   */
  specVersion: '1.0.0';
  name?: string;
  description?: string;
  data: {
    countTable: TableReference;
    sampleMetadata: TableReference;
    featureMetadata: TableReference;
    phylogeneticTree?: TreeReference | null;
  };
  roles: {
    response: {
      table: 'countTable';
      sampleIdColumn: ColumnName;
    };
    samples: {
      table: 'sampleMetadata';
      sampleIdColumn: ColumnName;
      /**
       * @minItems 1
       */
      focalVariables: [
        {
          column: ColumnName;
          type: 'continuous' | 'categorical' | 'binary';
          referenceLevel?: string;
        },
        ...{
          column: ColumnName;
          type: 'continuous' | 'categorical' | 'binary';
          referenceLevel?: string;
        }[],
      ];
    };
    features: {
      table: 'featureMetadata';
      featureIdColumn: ColumnName;
      taxonomyColumns: ColumnName[];
      functionalTraits: TypedColumn[];
      technicalQc: {
        completenessColumn: ColumnName;
        contaminationColumn: ColumnName;
        genomeSizeColumn: ColumnName;
        filters: {
          minimumCompleteness: number;
          maximumContamination: number;
        };
        /**
         * Must be true before genome size may also appear in functionalTraits.
         */
        genomeSizeHasEcologicalRole: boolean;
      };
    };
  };
  model: {
    family: 'negative_binomial' | 'zinb';
    offset: {
      /**
       * Count models always include a log library-size effort offset.
       */
      librarySize: true;
      genomeSizeCorrection: boolean;
      completenessCorrection: boolean;
    };
    latentVariables: number;
    phylogeneticRandomEffect: {
      enabled: boolean;
      covariance: 'vcv' | 'cophenetic';
      approximation: 'full' | 'nngp';
      preserveTipOrder: true;
    };
    fourthCorner: {
      enabled: boolean;
      /**
       * A declarative fourth-corner formula over named focal variables and traits.
       */
      formula: string | null;
    };
  };
  engine: 'gllvm' | 'hmsc' | 'hmsc_hpc' | 'vae';
  resources: {
    cpuThreads: number;
    /**
     * @minItems 1
     */
    cpuAffinity?: [number, ...number[]];
    gpuDevice?: number;
    gpuMemoryLimitMB?: number;
    memorySoftLimitMB: number;
    memoryHardLimitMB?: number;
  };
  seed: number;
  output: {
    path: RelativePath;
    overwrite: boolean;
  };
};
/**
 * A path relative to the portable job root.
 */
export type RelativePath = string;
export type Sha256 = string;
export type ColumnName = string;

export interface TableReference {
  path: RelativePath;
  sha256: Sha256;
  format: 'csv' | 'tsv' | 'parquet';
}
export interface TreeReference {
  path: RelativePath;
  sha256: Sha256;
  format: 'newick';
}
export interface TypedColumn {
  column: ColumnName;
  type: 'continuous' | 'categorical' | 'binary';
}
