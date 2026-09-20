import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
import { format } from 'prettier';

const contracts = [
  {
    schemaPath: 'schemas/model-spec.schema.json',
    typeName: 'ModelSpec',
    outputPath: 'app/src/shared/model-spec.d.ts',
  },
  {
    schemaPath: 'schemas/results-bundle.schema.json',
    typeName: 'ResultsBundle',
    outputPath: 'app/src/shared/results-bundle.d.ts',
  },
];

for (const contract of contracts) {
  const schema = JSON.parse(await readFile(contract.schemaPath, 'utf8'));
  const source = await compile(schema, contract.typeName, {
    bannerComment:
      '/* Generated from schemas/. Do not edit directly; run `pnpm generate:types`. */',
    style: {
      singleQuote: true,
      trailingComma: 'all',
    },
  });
  const formatted = await format(source, {
    parser: 'typescript',
    singleQuote: true,
    trailingComma: 'all',
  });
  await writeFile(contract.outputPath, formatted);
}
