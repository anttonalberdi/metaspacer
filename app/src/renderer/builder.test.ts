import { describe, expect, it } from 'vitest';
import {
  buildModelSpec,
  encodeBase64,
  initialDraft,
  inspectTable,
  parseDelimited,
  schemaErrors,
  type BuilderFile,
} from './builder';

function table(name: string, content: string): BuilderFile {
  return inspectTable(
    name,
    encodeBase64(new TextEncoder().encode(content)),
    'a'.repeat(64),
    content.length,
  );
}

describe('design-builder table inspection', () => {
  it('parses quoted CSV fields and tab-separated tables', () => {
    expect(parseDelimited('id,label\n1,"Zoo, A"\n', ',')).toEqual([
      ['id', 'label'],
      ['1', 'Zoo, A'],
    ]);
    expect(parseDelimited('id\tgroup\n1\tWild\n', '\t')).toEqual([
      ['id', 'group'],
      ['1', 'Wild'],
    ]);
  });

  it('infers identifiers, QC columns, and a first focal variable', () => {
    const files = {
      countTable: table('counts.csv', 'sample_id,F1\nS1,2\nS2,3\n'),
      sampleMetadata: table(
        'samples.csv',
        'sample_id,group,temperature\nS1,Wild,10\nS2,Zoo,12\n',
      ),
      featureMetadata: table(
        'features.csv',
        'feature_id,phylum,completeness_pct,contamination_pct,genome_size_bp\nF1,Firmicutes,98,1,2000\n',
      ),
    };
    const draft = initialDraft(files);

    expect(draft.responseSampleId).toBe('sample_id');
    expect(draft.metadataSampleId).toBe('sample_id');
    expect(draft.featureId).toBe('feature_id');
    expect(draft.focalVariables).toEqual([
      { column: 'group', type: 'binary', referenceLevel: 'Wild' },
    ]);
    expect(draft.taxonomyColumns).toEqual(['phylum']);
    expect(draft.completenessColumn).toBe('completeness_pct');
  });
});

describe('design-builder model spec', () => {
  it('emits a schema-valid, hash-pinned gllvm spec', () => {
    const files = {
      countTable: table('counts.csv', 'sample_id,F1\nS1,2\nS2,3\n'),
      sampleMetadata: table(
        'samples.csv',
        'sample_id,group\nS1,Wild\nS2,Zoo\n',
      ),
      featureMetadata: table(
        'features.csv',
        'feature_id,phylum,completeness_pct,contamination_pct,genome_size_bp\nF1,Firmicutes,98,1,2000\n',
      ),
    };
    const spec = buildModelSpec(initialDraft(files), files);

    expect(schemaErrors(spec)).toEqual([]);
    expect(spec.data.countTable.path).toBe('data/count-table.csv');
    expect(spec.data.countTable.sha256).toBe('a'.repeat(64));
    expect(spec.model.offset.librarySize).toBe(true);
    expect(spec.engine).toBe('gllvm');
  });
});
