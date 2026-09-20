/* Generated from schemas/. Do not edit directly; run `pnpm generate:types`. */

export type ConfidenceTier = 'measured' | 'interpolated' | 'extrapolated';
export type OrdinatedState = {
  stateId: string;
  sampleId?: string;
  kind: 'observed' | 'predicted';
  group: string;
  condition: {
    [k: string]: string | number | boolean;
  };
  tier: ConfidenceTier;
  /**
   * @minItems 2
   */
  coordinates: [Coordinate, Coordinate, ...Coordinate[]];
  geometry: GeometryFlag;
} & {
  stateId: string;
  sampleId?: string;
  kind: 'observed' | 'predicted';
  group: string;
  condition: {
    [k: string]: string | number | boolean;
  };
  tier: ConfidenceTier;
  /**
   * @minItems 2
   */
  coordinates: [Coordinate, Coordinate, ...Coordinate[]];
  geometry: GeometryFlag;
};
export type PredictorEncoding =
  | {
      name: string;
      type: 'categorical';
      /**
       * @minItems 2
       */
      levels: [string, string, ...string[]];
      referenceLevel: string;
    }
  | {
      name: string;
      type: 'continuous';
      center: number;
      scale: number;
    }
  | {
      name: string;
      type: 'binary';
      falseValue: Scalar;
      trueValue: Scalar;
    };
export type Scalar = string | number | boolean;
export type Vector = number[];
/**
 * Coefficient-by-response matrix.
 */
export type Matrix = Vector[];
/**
 * Latent-variable-by-response Lambda matrix.
 */
export type Matrix1 = Vector[];
export type Matrix2 = Vector[];
/**
 * Response-by-axis shared rotation matrix.
 */
export type Matrix3 = Vector[];
export type Sha256 = string;

/**
 * Engine-neutral precomputed results, projection parameters, and provenance.
 */
export interface ResultsBundle {
  bundleVersion: '1.0.0';
  specVersion: '1.0.0';
  precomputed: {
    /**
     * @minItems 8
     */
    metrics: [
      Metric,
      Metric,
      Metric,
      Metric,
      Metric,
      Metric,
      Metric,
      Metric,
      ...Metric[],
    ];
    ordination: {
      /**
       * @minItems 2
       */
      axisLabels: [string, string, ...string[]];
      /**
       * @minItems 1
       */
      states: [OrdinatedState, ...OrdinatedState[]];
    };
  };
  fittedParameters: {
    dimensions: {
      responses: number;
      coefficients: number;
      latentVariables: number;
      projectionAxes: number;
    };
    /**
     * @minItems 1
     */
    responseFeatures: [string, ...string[]];
    /**
     * @minItems 1
     */
    coefficientNames: [string, ...string[]];
    design: {
      /**
       * @minItems 1
       */
      predictors: [PredictorEncoding, ...PredictorEncoding[]];
      /**
       * @minItems 1
       */
      columns: [DesignColumn, ...DesignColumn[]];
    };
    offset: {
      librarySize: {
        source: 'count_table_row_sum' | 'metadata_column';
        column?: string;
        transform: 'log';
        referenceValue: number;
      };
      genomeSizeCorrection: boolean;
      completenessCorrection: boolean;
    };
    beta: Matrix;
    latentLoadings: Matrix1;
    latentDistribution: {
      mean: Vector;
      covariance: Matrix2;
    };
    projection: {
      center: Vector;
      rotation: Matrix3;
    };
    family: {
      name: 'negative_binomial' | 'zinb';
      link: 'log';
      dispersion: Vector;
      zeroInflation?: Vector;
    };
    uncertainty: SamplingCovariance | PosteriorDraws;
  };
  provenance: {
    specSha256: Sha256;
    dataSha256: {
      countTable: Sha256;
      sampleMetadata: Sha256;
      featureMetadata: Sha256;
      phylogeneticTree?: Sha256;
    };
    engine: {
      name: 'gllvm' | 'hmsc' | 'hmsc_hpc' | 'vae';
      version: string;
    };
    metaspacerVersion: string;
    seed: number;
    createdAt: string;
    tierDefinitions: {
      measured: string;
      interpolated: string;
      extrapolated: string;
    };
    extrapolationMethod: {
      name: 'convex_hull' | 'observed_range' | 'mixed_hull_range';
      /**
       * @minItems 1
       */
      conditionColumns: [string, ...string[]];
    };
    warnings?: string[];
  };
}
export interface Metric {
  id:
    | 'dispersion'
    | 'effective_dimensionality'
    | 'schoener_d'
    | 'containment'
    | 'transition_distance'
    | 'plasticity'
    | 'variance_partition'
    | 'chao_coverage';
  label: string;
  tier: ConfidenceTier;
  estimate: Estimate;
  unit: string;
  scope: {
    [k: string]: string | number | boolean;
  };
  note?: string;
}
export interface Estimate {
  median: number;
  lower: number;
  upper: number;
  level: number;
  intervalType: 'confidence' | 'credible' | 'bootstrap' | 'empirical';
}
export interface Coordinate {
  axis: string;
  estimate: Estimate;
}
export interface GeometryFlag {
  method: 'convex_hull' | 'observed_range' | 'mixed_hull_range';
  insideSampledDomain: boolean;
  distanceToDomain: number;
}
export interface DesignColumn {
  name: string;
  factors: (
    | {
        predictor: string;
        operation: 'identity';
      }
    | {
        predictor: string;
        operation: 'indicator';
        level: Scalar;
      }
  )[];
}
export interface SamplingCovariance {
  kind: 'sampling_covariance';
  /**
   * @minItems 1
   */
  parameterOrder: [string, ...string[]];
  covariance:
    | {
        representation: 'diagonal';
        diagonal: Vector;
      }
    | {
        representation: 'dense';
        values: Matrix2;
      };
}
export interface PosteriorDraws {
  kind: 'posterior_draws';
  /**
   * @minItems 1
   */
  parameterOrder: [string, ...string[]];
  draws: Matrix2;
}
