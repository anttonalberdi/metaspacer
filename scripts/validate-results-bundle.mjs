import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const bundlePath = process.argv[2];
if (!bundlePath) {
  throw new Error(
    'Usage: node scripts/validate-results-bundle.mjs <bundle.json>',
  );
}

const [schema, bundle] = await Promise.all([
  readFile('schemas/results-bundle.schema.json', 'utf8').then(JSON.parse),
  readFile(bundlePath, 'utf8').then(JSON.parse),
]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
assert.equal(validate(bundle), true, ajv.errorsText(validate.errors));

const parameters = bundle.fittedParameters;
const dimensions = parameters.dimensions;
assert.equal(parameters.responseFeatures.length, dimensions.responses);
assert.equal(parameters.coefficientNames.length, dimensions.coefficients);
assert.equal(parameters.beta.length, dimensions.coefficients);
assert.ok(parameters.beta.every((row) => row.length === dimensions.responses));
assert.equal(parameters.latentLoadings.length, dimensions.latentVariables);
assert.ok(
  parameters.latentLoadings.every((row) => row.length === dimensions.responses),
);
assert.equal(parameters.projection.rotation.length, dimensions.responses);
assert.ok(
  parameters.projection.rotation.every(
    (row) => row.length === dimensions.projectionAxes,
  ),
);
assert.equal(
  parameters.uncertainty.parameterOrder.length,
  parameters.uncertainty.covariance.diagonal.length,
);

console.log(
  `Valid results bundle: ${dimensions.responses} responses, ` +
    `${dimensions.latentVariables} latent variables, ` +
    `${bundle.precomputed.ordination.states.length} states.`,
);
