import type {
  ConfidenceTier,
  Estimate,
  GeometryFlag,
  Metric,
  PredictorEncoding,
  ResultsBundle,
  Scalar,
} from '../shared/results-bundle';

export type ProjectionCondition = Record<string, Scalar>;

export interface ProjectedCoordinate {
  axis: string;
  estimate: Estimate;
}

export interface CompositionEstimate {
  feature: string;
  estimate: Estimate;
}

export interface ConditionProjection {
  condition: ProjectionCondition;
  group: string;
  tier: Exclude<ConfidenceTier, 'measured'>;
  geometry: GeometryFlag;
  coverage?: Estimate;
  design: number[];
  linearPredictor: number[];
  coordinates: ProjectedCoordinate[];
  composition: CompositionEstimate[];
}

export interface ProjectionTransition {
  from: ConditionProjection;
  to: ConditionProjection;
  distance: Estimate;
}

interface ParameterDraw {
  beta: number[][];
  loadings: number[][];
}

interface ConditionDraws {
  coordinateDraws: number[][];
  compositionDraws: number[][];
}

interface Point {
  x: number;
  y: number;
}

const DRAW_COUNT = 200;
const EPSILON = 1e-10;

function sameScalar(left: Scalar, right: Scalar): boolean {
  return String(left) === String(right);
}

function predictorByName(
  bundle: ResultsBundle,
  name: string,
): PredictorEncoding {
  const predictor = bundle.fittedParameters.design.predictors.find(
    (candidate) => candidate.name === name,
  );
  if (!predictor) throw new Error(`Unknown predictor: ${name}`);
  return predictor;
}

function encodedIdentity(predictor: PredictorEncoding, value: Scalar): number {
  if (predictor.type === 'continuous') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${predictor.name} must be numeric.`);
    }
    return (numeric - predictor.center) / predictor.scale;
  }
  if (predictor.type === 'binary') {
    return sameScalar(value, predictor.trueValue) ? 1 : 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${predictor.name} cannot be used as a numeric identity.`);
  }
  return numeric;
}

function validateCondition(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
): void {
  for (const predictor of bundle.fittedParameters.design.predictors) {
    const value = condition[predictor.name];
    if (value === undefined) {
      throw new Error(`Missing predictor: ${predictor.name}`);
    }
    if (
      predictor.type === 'categorical' &&
      !predictor.levels.some((level) => sameScalar(value, level))
    ) {
      throw new Error(`${String(value)} is not a level of ${predictor.name}.`);
    }
    if (
      predictor.type === 'binary' &&
      !sameScalar(value, predictor.falseValue) &&
      !sameScalar(value, predictor.trueValue)
    ) {
      throw new Error(`${String(value)} is not a value of ${predictor.name}.`);
    }
  }
}

export function encodeCondition(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
): number[] {
  validateCondition(bundle, condition);
  return bundle.fittedParameters.design.columns.map((column) =>
    column.factors.reduce((value, factor) => {
      const raw = condition[factor.predictor];
      if (factor.operation === 'indicator') {
        return value * (sameScalar(raw, factor.level) ? 1 : 0);
      }
      return (
        value * encodedIdentity(predictorByName(bundle, factor.predictor), raw)
      );
    }, 1),
  );
}

function observedConditions(bundle: ResultsBundle): ProjectionCondition[] {
  return bundle.precomputed.ordination.states
    .filter((state) => state.kind === 'observed')
    .map((state) => state.condition);
}

function sortedMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function matchingObservedValues(
  bundle: ResultsBundle,
  partial: ProjectionCondition,
  predictorName: string,
): number[] {
  const discrete = bundle.fittedParameters.design.predictors.filter(
    (predictor) => predictor.type !== 'continuous',
  );
  return observedConditions(bundle)
    .filter((condition) =>
      discrete.every((predictor) => {
        const selected = partial[predictor.name];
        return (
          selected === undefined ||
          sameScalar(condition[predictor.name], selected)
        );
      }),
    )
    .map((condition) => Number(condition[predictorName]))
    .filter(Number.isFinite);
}

export function defaultCondition(
  bundle: ResultsBundle,
  contrast = false,
): ProjectionCondition {
  const condition: ProjectionCondition = {};
  for (const predictor of bundle.fittedParameters.design.predictors) {
    if (predictor.type === 'categorical') {
      condition[predictor.name] = contrast
        ? (predictor.levels.find(
            (level) => level !== predictor.referenceLevel,
          ) ?? predictor.referenceLevel)
        : predictor.referenceLevel;
    } else if (predictor.type === 'binary') {
      condition[predictor.name] = contrast
        ? predictor.trueValue
        : predictor.falseValue;
    }
  }
  for (const predictor of bundle.fittedParameters.design.predictors) {
    if (predictor.type === 'continuous') {
      const values = matchingObservedValues(bundle, condition, predictor.name);
      condition[predictor.name] =
        values.length > 0 ? sortedMedian(values) : predictor.center;
    }
  }
  return condition;
}

export function observedRange(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
  predictorName: string,
): { min: number; max: number } {
  const values = matchingObservedValues(bundle, condition, predictorName);
  if (values.length === 0) {
    const predictor = predictorByName(bundle, predictorName);
    if (predictor.type !== 'continuous') return { min: 0, max: 1 };
    return {
      min: predictor.center - predictor.scale,
      max: predictor.center + predictor.scale,
    };
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

function cross(origin: Point, left: Point, right: Point): number {
  return (
    (left.x - origin.x) * (right.y - origin.y) -
    (left.y - origin.y) * (right.x - origin.x)
  );
}

function convexHull(points: Point[]): Point[] {
  const unique = [
    ...new Map(
      points.map((point) => [`${point.x}:${point.y}`, point]),
    ).values(),
  ].sort((left, right) => left.x - right.x || left.y - right.y);
  if (unique.length <= 2) return unique;
  const lower: Point[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...unique].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const position = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator,
    ),
  );
  return Math.hypot(
    point.x - (start.x + position * dx),
    point.y - (start.y + position * dy),
  );
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (distanceToSegment(point, start, end) < EPSILON) return true;
    const crosses =
      start.y > point.y !== end.y > point.y &&
      point.x <
        ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function classifyCondition(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
): GeometryFlag {
  validateCondition(bundle, condition);
  const predictors = bundle.fittedParameters.design.predictors;
  const discrete = predictors.filter(
    (predictor) => predictor.type !== 'continuous',
  );
  const continuous = predictors.filter(
    (predictor) => predictor.type === 'continuous',
  );
  const matching = observedConditions(bundle).filter((observed) =>
    discrete.every((predictor) =>
      sameScalar(observed[predictor.name], condition[predictor.name]),
    ),
  );
  const method = bundle.provenance.extrapolationMethod.name;
  if (matching.length === 0) {
    return { method, insideSampledDomain: false, distanceToDomain: 1 };
  }
  if (continuous.length === 0) {
    return { method, insideSampledDomain: true, distanceToDomain: 0 };
  }
  const point = continuous.map(
    (predictor) =>
      (Number(condition[predictor.name]) - predictor.center) / predictor.scale,
  );
  const observed = matching.map((candidate) =>
    continuous.map(
      (predictor) =>
        (Number(candidate[predictor.name]) - predictor.center) /
        predictor.scale,
    ),
  );

  if (continuous.length === 1) {
    const values = observed.map((candidate) => candidate[0]);
    const distance = Math.max(
      Math.min(...values) - point[0],
      point[0] - Math.max(...values),
      0,
    );
    return {
      method,
      insideSampledDomain: distance <= EPSILON,
      distanceToDomain: Math.max(0, distance),
    };
  }

  if (continuous.length === 2) {
    const hull = convexHull(
      observed.map((candidate) => ({ x: candidate[0], y: candidate[1] })),
    );
    if (hull.length >= 3) {
      const candidate = { x: point[0], y: point[1] };
      const inside = pointInPolygon(candidate, hull);
      const distance = Math.min(
        ...hull.map((start, index) =>
          distanceToSegment(candidate, start, hull[(index + 1) % hull.length]),
        ),
      );
      return {
        method,
        insideSampledDomain: inside,
        distanceToDomain: inside ? 0 : distance,
      };
    }
  }

  const excess = point.map((value, index) => {
    const values = observed.map((candidate) => candidate[index]);
    return Math.max(
      Math.min(...values) - value,
      value - Math.max(...values),
      0,
    );
  });
  const distance = Math.hypot(...excess);
  return {
    method,
    insideSampledDomain: distance <= EPSILON,
    distanceToDomain: distance,
  };
}

function multiplyVectorMatrix(vector: number[], matrix: number[][]): number[] {
  if (matrix.length === 0) return [];
  return matrix[0].map((_, column) =>
    vector.reduce(
      (sum, value, row) => sum + value * (matrix[row]?.[column] ?? 0),
      0,
    ),
  );
}

function addVectors(left: number[], right: number[]): number[] {
  return left.map((value, index) => value + (right[index] ?? 0));
}

function centralLinearPredictor(
  bundle: ResultsBundle,
  design: number[],
): number[] {
  const fixed = multiplyVectorMatrix(design, bundle.fittedParameters.beta);
  const latent = multiplyVectorMatrix(
    bundle.fittedParameters.latentDistribution.mean,
    bundle.fittedParameters.latentLoadings,
  );
  return addVectors(fixed, latent);
}

function projectLinearPredictor(
  bundle: ResultsBundle,
  linearPredictor: number[],
): number[] {
  const centered = linearPredictor.map(
    (value, index) => value - bundle.fittedParameters.projection.center[index],
  );
  return multiplyVectorMatrix(
    centered,
    bundle.fittedParameters.projection.rotation,
  );
}

function reconstructLinearPredictor(
  bundle: ResultsBundle,
  coordinates: number[],
): number[] {
  return bundle.fittedParameters.projection.center.map(
    (center, response) =>
      center +
      coordinates.reduce(
        (sum, coordinate, axis) =>
          sum +
          coordinate *
            (bundle.fittedParameters.projection.rotation[response]?.[axis] ??
              0),
        0,
      ),
  );
}

function relativeComposition(
  bundle: ResultsBundle,
  linearPredictor: number[],
): number[] {
  const maximum = Math.max(...linearPredictor);
  const abundance = linearPredictor.map((value, index) => {
    const zeroInflation =
      bundle.fittedParameters.family.zeroInflation?.[index] ?? 0;
    return Math.exp(value - maximum) * Math.max(0, 1 - zeroInflation);
  });
  const total = abundance.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return abundance.map(() => 0);
  return abundance.map((value) => value / total);
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  const first = Math.max(random(), Number.EPSILON);
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function cholesky(matrix: number[][]): number[][] {
  const size = matrix.length;
  const output = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0),
  );
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row]?.[column] ?? 0;
      for (let index = 0; index < column; index += 1) {
        value -= output[row][index] * output[column][index];
      }
      if (row === column) {
        output[row][column] = Math.sqrt(Math.max(0, value));
      } else if (output[column][column] > Number.EPSILON) {
        output[row][column] = value / output[column][column];
      }
    }
  }
  return output;
}

function correlatedNormal(factor: number[][], random: () => number): number[] {
  const independent = factor.map(() => normal(random));
  return factor.map((row, index) =>
    row
      .slice(0, index + 1)
      .reduce(
        (sum, coefficient, column) => sum + coefficient * independent[column],
        0,
      ),
  );
}

function parameterMap(bundle: ResultsBundle): Map<string, number> {
  const values = new Map<string, number>();
  const { coefficientNames, responseFeatures, beta, latentLoadings } =
    bundle.fittedParameters;
  coefficientNames.forEach((coefficient, row) => {
    responseFeatures.forEach((feature, column) => {
      values.set(`Beta[${coefficient},${feature}]`, beta[row][column]);
    });
  });
  latentLoadings.forEach((loading, row) => {
    responseFeatures.forEach((feature, column) => {
      values.set(`Lambda[LV${row + 1},${feature}]`, loading[column]);
    });
  });
  return values;
}

function matricesFromParameters(
  bundle: ResultsBundle,
  order: string[],
  values: number[],
): ParameterDraw {
  const beta = bundle.fittedParameters.beta.map((row) => [...row]);
  const loadings = bundle.fittedParameters.latentLoadings.map((row) => [
    ...row,
  ]);
  const coefficients = new Map(
    bundle.fittedParameters.coefficientNames.map((name, index) => [
      name,
      index,
    ]),
  );
  const responses = new Map(
    bundle.fittedParameters.responseFeatures.map((name, index) => [
      name,
      index,
    ]),
  );
  order.forEach((name, index) => {
    const betaMatch = /^Beta\[(.*),([^,]+)]$/.exec(name);
    if (betaMatch) {
      const row = coefficients.get(betaMatch[1]);
      const column = responses.get(betaMatch[2]);
      if (row !== undefined && column !== undefined) {
        beta[row][column] = values[index];
      }
      return;
    }
    const loadingMatch = /^Lambda\[LV(\d+),([^,]+)]$/.exec(name);
    if (loadingMatch) {
      const row = Number(loadingMatch[1]) - 1;
      const column = responses.get(loadingMatch[2]);
      if (loadings[row] && column !== undefined) {
        loadings[row][column] = values[index];
      }
    }
  });
  return { beta, loadings };
}

function makeParameterDraws(
  bundle: ResultsBundle,
  count: number,
  random: () => number,
): ParameterDraw[] {
  const uncertainty = bundle.fittedParameters.uncertainty;
  const order = [...uncertainty.parameterOrder];
  if (uncertainty.kind === 'posterior_draws') {
    return Array.from({ length: count }, (_, index) => {
      const source = uncertainty.draws[index % uncertainty.draws.length];
      return matricesFromParameters(bundle, order, source);
    });
  }

  const centers = parameterMap(bundle);
  const mean = order.map((name) => centers.get(name) ?? 0);
  const covariance =
    uncertainty.covariance.representation === 'dense'
      ? uncertainty.covariance.values
      : uncertainty.covariance.diagonal.map((variance, row) =>
          uncertainty.covariance.representation === 'diagonal'
            ? uncertainty.covariance.diagonal.map((_, column) =>
                row === column ? variance : 0,
              )
            : [],
        );
  const factor = cholesky(covariance);
  return Array.from({ length: count }, () => {
    const deviation = correlatedNormal(factor, random);
    return matricesFromParameters(
      bundle,
      order,
      mean.map((value, index) => value + deviation[index]),
    );
  });
}

function makeConditionDraws(
  bundle: ResultsBundle,
  design: number[],
  parameterDraws: ParameterDraw[],
  random: () => number,
): ConditionDraws {
  const latentFactor = cholesky(
    bundle.fittedParameters.latentDistribution.covariance,
  );
  const latentMean = bundle.fittedParameters.latentDistribution.mean;
  const coordinateDraws: number[][] = [];
  const compositionDraws: number[][] = [];
  for (const parameters of parameterDraws) {
    const latentDeviation = correlatedNormal(latentFactor, random);
    const latent = latentMean.map(
      (value, index) => value + (latentDeviation[index] ?? 0),
    );
    const linearPredictor = addVectors(
      multiplyVectorMatrix(design, parameters.beta),
      multiplyVectorMatrix(latent, parameters.loadings),
    );
    const coordinates = projectLinearPredictor(bundle, linearPredictor);
    coordinateDraws.push(coordinates);
    compositionDraws.push(
      relativeComposition(
        bundle,
        reconstructLinearPredictor(bundle, coordinates),
      ),
    );
  }
  return { coordinateDraws, compositionDraws };
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return (
    sorted[lower] +
    fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower])
  );
}

function estimate(
  central: number,
  values: number[],
  intervalType: Estimate['intervalType'],
): Estimate {
  return {
    median: central,
    lower: Math.min(central, quantile(values, 0.025)),
    upper: Math.max(central, quantile(values, 0.975)),
    level: 0.95,
    intervalType,
  };
}

function groupForCondition(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
): string {
  const groupPredictor = bundle.fittedParameters.design.predictors.find(
    (predictor) => predictor.type === 'categorical',
  );
  return groupPredictor ? String(condition[groupPredictor.name]) : 'Projected';
}

function coverageForGroup(
  bundle: ResultsBundle,
  group: string,
): Estimate | undefined {
  return bundle.precomputed.metrics.find(
    (metric: Metric) =>
      metric.id === 'chao_coverage' && String(metric.scope.group) === group,
  )?.estimate;
}

function buildProjection(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
  design: number[],
  draws: ConditionDraws,
): ConditionProjection {
  const linearPredictor = centralLinearPredictor(bundle, design);
  const centralCoordinates = projectLinearPredictor(bundle, linearPredictor);
  const centralComposition = relativeComposition(
    bundle,
    reconstructLinearPredictor(bundle, centralCoordinates),
  );
  const geometry = classifyCondition(bundle, condition);
  const intervalType =
    bundle.fittedParameters.uncertainty.kind === 'posterior_draws'
      ? 'credible'
      : 'confidence';
  const group = groupForCondition(bundle, condition);
  return {
    condition,
    group,
    tier: geometry.insideSampledDomain ? 'interpolated' : 'extrapolated',
    geometry,
    coverage: coverageForGroup(bundle, group),
    design,
    linearPredictor,
    coordinates: centralCoordinates.map((central, axis) => ({
      axis:
        bundle.precomputed.ordination.axisLabels[axis] ?? `Space ${axis + 1}`,
      estimate: estimate(
        central,
        draws.coordinateDraws.map((draw) => draw[axis]),
        intervalType,
      ),
    })),
    composition: bundle.fittedParameters.responseFeatures
      .map((feature, response) => ({
        feature,
        estimate: estimate(
          centralComposition[response],
          draws.compositionDraws.map((draw) => draw[response]),
          intervalType,
        ),
      }))
      .sort((left, right) => right.estimate.median - left.estimate.median),
  };
}

export function projectCondition(
  bundle: ResultsBundle,
  condition: ProjectionCondition,
  drawCount = DRAW_COUNT,
): ConditionProjection {
  const design = encodeCondition(bundle, condition);
  const random = makeRandom(
    bundle.provenance.seed ^ hashText(JSON.stringify(condition)),
  );
  const parameterDraws = makeParameterDraws(
    bundle,
    Math.max(1, drawCount),
    random,
  );
  return buildProjection(
    bundle,
    { ...condition },
    design,
    makeConditionDraws(bundle, design, parameterDraws, random),
  );
}

export function projectTransition(
  bundle: ResultsBundle,
  fromCondition: ProjectionCondition,
  toCondition: ProjectionCondition,
  drawCount = DRAW_COUNT,
): ProjectionTransition {
  const fromDesign = encodeCondition(bundle, fromCondition);
  const toDesign = encodeCondition(bundle, toCondition);
  const random = makeRandom(
    bundle.provenance.seed ^
      hashText(
        `${JSON.stringify(fromCondition)}:${JSON.stringify(toCondition)}`,
      ),
  );
  const parameterDraws = makeParameterDraws(
    bundle,
    Math.max(1, drawCount),
    random,
  );
  const fromDraws = makeConditionDraws(
    bundle,
    fromDesign,
    parameterDraws,
    random,
  );
  const toDraws = makeConditionDraws(bundle, toDesign, parameterDraws, random);
  const from = buildProjection(
    bundle,
    { ...fromCondition },
    fromDesign,
    fromDraws,
  );
  const to = buildProjection(bundle, { ...toCondition }, toDesign, toDraws);
  const central = Math.hypot(
    ...from.coordinates.map(
      (coordinate, axis) =>
        to.coordinates[axis].estimate.median - coordinate.estimate.median,
    ),
  );
  const distances = fromDraws.coordinateDraws.map((coordinates, draw) =>
    Math.hypot(
      ...coordinates.map(
        (coordinate, axis) => toDraws.coordinateDraws[draw][axis] - coordinate,
      ),
    ),
  );
  return {
    from,
    to,
    distance: estimate(
      central,
      distances,
      bundle.fittedParameters.uncertainty.kind === 'posterior_draws'
        ? 'credible'
        : 'confidence',
    ),
  };
}
