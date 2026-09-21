import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import modelSpecSchema from '../../../schemas/model-spec.schema.json';
import type { ModelSpec } from '../shared/model-spec';

export type InputRole =
  'countTable' | 'sampleMetadata' | 'featureMetadata' | 'phylogeneticTree';

export type ColumnType = 'continuous' | 'categorical' | 'binary';

export interface BuilderFile {
  name: string;
  contentBase64: string;
  sha256: string;
  size: number;
  format: 'csv' | 'tsv' | 'newick';
  columns: string[];
  values: Record<string, string[]>;
  rowCount: number;
}

export interface FocalRole {
  column: string;
  type: ColumnType;
  referenceLevel?: string;
}

export interface TraitRole {
  column: string;
  type: ColumnType;
}

export interface BuilderDraft {
  name: string;
  responseSampleId: string;
  metadataSampleId: string;
  focalVariables: FocalRole[];
  featureId: string;
  taxonomyColumns: string[];
  functionalTraits: TraitRole[];
  completenessColumn: string;
  contaminationColumn: string;
  genomeSizeColumn: string;
  minimumCompleteness: number;
  maximumContamination: number;
  genomeSizeHasEcologicalRole: boolean;
  family: 'negative_binomial' | 'zinb';
  latentVariables: number;
  usePhylogeny: boolean;
  fourthCornerEnabled: boolean;
  fourthCornerFormula: string;
  cpuThreads: number;
  memorySoftLimitMB: number;
  seed: number;
  outputPath: string;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  details: Record<string, unknown>;
}

export interface CostEstimate {
  engine: string;
  samples: number;
  responses: number;
  latentVariables: number;
  estimatedMemoryMB: number;
  estimatedRuntimeSeconds: { lower: number; upper: number };
  responseIdColumn: string;
  guidance: string;
}

export interface PreflightResult {
  validation: {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  cost: CostEstimate | null;
}

export interface PreflightPayload {
  spec: ModelSpec;
  files: Array<{ path: string; contentBase64: string }>;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSpec = ajv.compile(modelSpecSchema);

const dataPaths: Record<InputRole, string> = {
  countTable: 'data/count-table',
  sampleMetadata: 'data/sample-metadata',
  featureMetadata: 'data/feature-metadata',
  phylogeneticTree: 'data/phylogeny.nwk',
};

function extension(format: BuilderFile['format']): string {
  return format === 'newick' ? '' : `.${format}`;
}

export function specDataPath(role: InputRole, file: BuilderFile): string {
  return `${dataPaths[role]}${extension(file.format)}`;
}

function formatSchemaError(error: ErrorObject): string {
  const location = error.instancePath || 'document root';
  return `${location} ${error.message ?? 'is invalid'}`;
}

export function schemaErrors(spec: ModelSpec): string[] {
  if (validateSpec(spec)) return [];
  return (validateSpec.errors ?? []).map(formatSchemaError);
}

export function decodeBase64(content: string): string {
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function tableFormat(name: string): 'csv' | 'tsv' {
  return name.toLowerCase().endsWith('.tsv') ? 'tsv' : 'csv';
}

export function parseDelimited(
  content: string,
  delimiter: ',' | '\t',
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  row.push(value.replace(/\r$/, ''));
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function inspectTable(
  name: string,
  contentBase64: string,
  digest: string,
  size: number,
): BuilderFile {
  const format = tableFormat(name);
  const rows = parseDelimited(
    decodeBase64(contentBase64),
    format === 'tsv' ? '\t' : ',',
  );
  const columns = rows[0] ?? [];
  const values = Object.fromEntries(
    columns.map((column, columnIndex) => [
      column,
      [...new Set(rows.slice(1).map((row) => row[columnIndex] ?? ''))].slice(
        0,
        100,
      ),
    ]),
  );
  return {
    name,
    contentBase64,
    sha256: digest,
    size,
    format,
    columns,
    values,
    rowCount: Math.max(0, rows.length - 1),
  };
}

export async function inspectBrowserFile(
  role: InputRole,
  file: File,
): Promise<BuilderFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentBase64 = encodeBase64(bytes);
  const digest = await sha256(bytes);
  if (role === 'phylogeneticTree') {
    return {
      name: file.name,
      contentBase64,
      sha256: digest,
      size: bytes.length,
      format: 'newick',
      columns: [],
      values: {},
      rowCount: 0,
    };
  }
  return inspectTable(file.name, contentBase64, digest, bytes.length);
}

export function inferredType(values: string[]): ColumnType {
  const distinct = new Set(values.filter(Boolean));
  if (distinct.size === 2) return 'binary';
  if (
    values.length > 0 &&
    values.every((value) => value === '' || Number.isFinite(Number(value)))
  ) {
    return 'continuous';
  }
  return 'categorical';
}

function matchingColumn(
  columns: string[],
  pattern: RegExp,
  fallback = '',
): string {
  return columns.find((column) => pattern.test(column)) ?? fallback;
}

export function initialDraft(
  files: Partial<Record<InputRole, BuilderFile>>,
): BuilderDraft {
  const countColumns = files.countTable?.columns ?? [];
  const sampleColumns = files.sampleMetadata?.columns ?? [];
  const featureColumns = files.featureMetadata?.columns ?? [];
  const responseSampleId = matchingColumn(
    countColumns,
    /sample.*id|^id$/i,
    countColumns[0],
  );
  const metadataSampleId = matchingColumn(
    sampleColumns,
    /sample.*id|^id$/i,
    sampleColumns[0],
  );
  const featureId = matchingColumn(
    featureColumns,
    /feature.*id|genome.*id|^id$/i,
    featureColumns[0],
  );
  const completenessColumn = matchingColumn(featureColumns, /completeness/i);
  const contaminationColumn = matchingColumn(featureColumns, /contamination/i);
  const genomeSizeColumn = matchingColumn(
    featureColumns,
    /genome.*size|size.*bp/i,
  );
  const taxonomyColumns = featureColumns.filter((column) =>
    /taxonomy|kingdom|phylum|class|order|family|genus|species/i.test(column),
  );
  const availableFocal = sampleColumns.filter(
    (column) => column !== metadataSampleId,
  );
  const firstFocal = availableFocal[0];

  return {
    name: 'Untitled metagenomic-space model',
    responseSampleId,
    metadataSampleId,
    focalVariables: firstFocal
      ? [
          {
            column: firstFocal,
            type: inferredType(files.sampleMetadata?.values[firstFocal] ?? []),
            referenceLevel: files.sampleMetadata?.values[firstFocal]?.[0],
          },
        ]
      : [],
    featureId,
    taxonomyColumns,
    functionalTraits: [],
    completenessColumn,
    contaminationColumn,
    genomeSizeColumn,
    minimumCompleteness: 90,
    maximumContamination: 5,
    genomeSizeHasEcologicalRole: false,
    family: 'negative_binomial',
    latentVariables: 2,
    usePhylogeny: Boolean(files.phylogeneticTree),
    fourthCornerEnabled: false,
    fourthCornerFormula: '',
    cpuThreads: Math.max(
      1,
      Math.min(
        4,
        typeof navigator === 'undefined'
          ? 1
          : navigator.hardwareConcurrency || 1,
      ),
    ),
    memorySoftLimitMB: 4096,
    seed: 731,
    outputPath: 'out/metaspacer-run',
  };
}

export function buildModelSpec(
  draft: BuilderDraft,
  files: Required<
    Pick<
      Record<InputRole, BuilderFile>,
      'countTable' | 'sampleMetadata' | 'featureMetadata'
    >
  > &
    Partial<Pick<Record<InputRole, BuilderFile>, 'phylogeneticTree'>>,
): ModelSpec {
  const focalVariables = draft.focalVariables.map((entry) => ({
    column: entry.column,
    type: entry.type,
    ...(entry.type === 'categorical' && entry.referenceLevel
      ? { referenceLevel: entry.referenceLevel }
      : {}),
  })) as ModelSpec['roles']['samples']['focalVariables'];
  const spec: ModelSpec = {
    specVersion: '1.0.0',
    name: draft.name,
    data: {
      countTable: {
        path: specDataPath('countTable', files.countTable),
        sha256: files.countTable.sha256,
        format: files.countTable.format === 'tsv' ? 'tsv' : 'csv',
      },
      sampleMetadata: {
        path: specDataPath('sampleMetadata', files.sampleMetadata),
        sha256: files.sampleMetadata.sha256,
        format: files.sampleMetadata.format === 'tsv' ? 'tsv' : 'csv',
      },
      featureMetadata: {
        path: specDataPath('featureMetadata', files.featureMetadata),
        sha256: files.featureMetadata.sha256,
        format: files.featureMetadata.format === 'tsv' ? 'tsv' : 'csv',
      },
    },
    roles: {
      response: { table: 'countTable', sampleIdColumn: draft.responseSampleId },
      samples: {
        table: 'sampleMetadata',
        sampleIdColumn: draft.metadataSampleId,
        focalVariables,
      },
      features: {
        table: 'featureMetadata',
        featureIdColumn: draft.featureId,
        taxonomyColumns: draft.taxonomyColumns,
        functionalTraits: draft.functionalTraits,
        technicalQc: {
          completenessColumn: draft.completenessColumn,
          contaminationColumn: draft.contaminationColumn,
          genomeSizeColumn: draft.genomeSizeColumn,
          filters: {
            minimumCompleteness: draft.minimumCompleteness,
            maximumContamination: draft.maximumContamination,
          },
          genomeSizeHasEcologicalRole: draft.genomeSizeHasEcologicalRole,
        },
      },
    },
    model: {
      family: draft.family,
      offset: {
        librarySize: true,
        genomeSizeCorrection: false,
        completenessCorrection: false,
      },
      latentVariables: draft.latentVariables,
      phylogeneticRandomEffect: {
        enabled: draft.usePhylogeny,
        covariance: 'vcv',
        approximation: 'full',
        preserveTipOrder: true,
      },
      fourthCorner: {
        enabled: draft.fourthCornerEnabled,
        formula: draft.fourthCornerEnabled ? draft.fourthCornerFormula : null,
      },
    },
    engine: 'gllvm',
    resources: {
      cpuThreads: draft.cpuThreads,
      memorySoftLimitMB: draft.memorySoftLimitMB,
    },
    seed: draft.seed,
    output: { path: draft.outputPath, overwrite: false },
  };
  if (files.phylogeneticTree) {
    spec.data.phylogeneticTree = {
      path: specDataPath('phylogeneticTree', files.phylogeneticTree),
      sha256: files.phylogeneticTree.sha256,
      format: 'newick',
    };
  }
  return spec;
}

export function preflightPayload(
  spec: ModelSpec,
  files: Partial<Record<InputRole, BuilderFile>>,
): PreflightPayload {
  return {
    spec,
    files: (Object.entries(files) as Array<[InputRole, BuilderFile]>).map(
      ([role, file]) => ({
        path: specDataPath(role, file),
        contentBase64: file.contentBase64,
      }),
    ),
  };
}
