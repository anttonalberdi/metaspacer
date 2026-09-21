import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import type { ModelSpec } from '../../shared/model-spec';
import {
  buildModelSpec,
  inferredType,
  initialDraft,
  inspectBrowserFile,
  inspectTable,
  preflightPayload,
  schemaErrors,
  type BuilderDraft,
  type BuilderFile,
  type ColumnType,
  type InputRole,
  type PreflightResult,
} from '../builder';

type Files = Partial<Record<InputRole, BuilderFile>>;
type RunRoute = 'local' | 'export';
type PreflightState =
  | { status: 'waiting' }
  | { status: 'checking' }
  | { status: 'unavailable'; message: string }
  | { status: 'complete'; result: PreflightResult };

const fileLabels: Record<
  InputRole,
  { label: string; hint: string; accept: string }
> = {
  countTable: {
    label: 'Count table',
    hint: 'samples × response features',
    accept: '.csv,.tsv,text/csv,text/tab-separated-values',
  },
  sampleMetadata: {
    label: 'Sample metadata',
    hint: 'sample IDs and conditions',
    accept: '.csv,.tsv,text/csv,text/tab-separated-values',
  },
  featureMetadata: {
    label: 'Feature metadata',
    hint: 'feature IDs, traits, taxonomy, QC',
    accept: '.csv,.tsv,text/csv,text/tab-separated-values',
  },
  phylogeneticTree: {
    label: 'Phylogenetic tree',
    hint: 'optional Newick tree',
    accept: '.nwk,.newick,.tree,text/plain',
  },
};

function completeFiles(files: Files): files is Files & {
  countTable: BuilderFile;
  sampleMetadata: BuilderFile;
  featureMetadata: BuilderFile;
} {
  return Boolean(
    files.countTable && files.sampleMetadata && files.featureMetadata,
  );
}

function numberValue(
  event: ChangeEvent<HTMLInputElement>,
  fallback: number,
): number {
  const value = Number(event.currentTarget.value);
  return Number.isFinite(value) ? value : fallback;
}

function affinityValue(value: string): number[] {
  if (!value.trim()) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(Number)
        .filter((entry) => Number.isInteger(entry) && entry >= 0),
    ),
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

function InputCard({
  role,
  file,
  onFile,
  onRemove,
}: {
  role: InputRole;
  file?: BuilderFile;
  onFile: (role: InputRole, file: File | BuilderFile | null) => void;
  onRemove: (role: InputRole) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const details = fileLabels[role];

  const open = async () => {
    if (window.metaspacer) {
      const selected = await window.metaspacer.openBuilderInput(role);
      if (!selected) return;
      const inspected =
        role === 'phylogeneticTree'
          ? {
              ...selected,
              format: 'newick' as const,
              columns: [],
              values: {},
              rowCount: 0,
            }
          : inspectTable(
              selected.name,
              selected.contentBase64,
              selected.sha256,
              selected.size,
            );
      onFile(role, inspected);
      return;
    }
    input.current?.click();
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    onFile(role, event.currentTarget.files?.[0] ?? null);
    event.currentTarget.value = '';
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    onFile(role, event.dataTransfer.files[0] ?? null);
  };

  return (
    <div
      className={`input-card ${file ? 'has-file' : ''} ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        aria-label={`${details.label} file`}
        accept={details.accept}
        onChange={choose}
      />
      <div className="input-card-number" aria-hidden="true">
        {role === 'phylogeneticTree'
          ? '04'
          : role === 'featureMetadata'
            ? '03'
            : role === 'sampleMetadata'
              ? '02'
              : '01'}
      </div>
      <div className="input-card-copy">
        <strong>{details.label}</strong>
        {file ? (
          <>
            <span>{file.name}</span>
            <small>
              {role === 'phylogeneticTree'
                ? formatBytes(file.size)
                : `${file.rowCount} rows · ${file.columns.length} columns`}
            </small>
          </>
        ) : (
          <>
            <span>{details.hint}</span>
            <small>Drop here or choose a file</small>
          </>
        )}
      </div>
      {file ? (
        <button
          className="card-action"
          type="button"
          onClick={() => onRemove(role)}
        >
          Remove
        </button>
      ) : (
        <button
          className="card-action"
          type="button"
          onClick={() => void open()}
        >
          Choose
        </button>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: string;
  columns: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">Select a column…</option>
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColumnChecks({
  columns,
  selected,
  onToggle,
}: {
  columns: string[];
  selected: string[];
  onToggle: (column: string, checked: boolean) => void;
}) {
  return (
    <div className="column-checks">
      {columns.map((column) => (
        <label key={column}>
          <input
            type="checkbox"
            checked={selected.includes(column)}
            onChange={(event) => onToggle(column, event.currentTarget.checked)}
          />
          <span>{column}</span>
        </label>
      ))}
    </div>
  );
}

export function DesignBuilder({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<Files>({});
  const [draft, setDraft] = useState<BuilderDraft>(() => initialDraft({}));
  const [preflight, setPreflight] = useState<PreflightState>({
    status: 'waiting',
  });
  const [route, setRoute] = useState<RunRoute | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [exportedJob, setExportedJob] = useState<ExportedJob | null>(null);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [cpuAffinityText, setCpuAffinityText] = useState('');
  const activeJobId = useRef<string | null>(null);

  useEffect(() => {
    if (!window.metaspacer) return;
    let mounted = true;
    void window.metaspacer
      .listJobs()
      .then((jobs) => {
        const active = jobs
          .filter((candidate) =>
            ['queued', 'running'].includes(candidate.status),
          )
          .at(-1);
        if (mounted && active) {
          activeJobId.current = active.id;
          setJob(active);
        }
      })
      .catch(() => undefined);
    const unsubscribe = window.metaspacer.onJobUpdate((update) => {
      if (update.id === activeJobId.current) setJob(update);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const useFile = async (
    role: InputRole,
    selectedFile: File | BuilderFile | null,
  ) => {
    if (!selectedFile || selectedFile.size === 0) return;
    try {
      const inspected =
        'contentBase64' in selectedFile
          ? selectedFile
          : await inspectBrowserFile(role, selectedFile);
      setFiles((current) => {
        const next = { ...current, [role]: inspected };
        setDraft(initialDraft(next));
        setCpuAffinityText('');
        return next;
      });
    } catch {
      setPreflight({
        status: 'unavailable',
        message: 'The selected input could not be read.',
      });
    }
  };

  const removeFile = (role: InputRole) => {
    setFiles((current) => {
      const next = { ...current };
      delete next[role];
      setDraft(initialDraft(next));
      setCpuAffinityText('');
      return next;
    });
  };

  const spec = useMemo<ModelSpec | null>(
    () => (completeFiles(files) ? buildModelSpec(draft, files) : null),
    [draft, files],
  );
  const contractErrors = useMemo(
    () => (spec ? schemaErrors(spec) : []),
    [spec],
  );
  const specJson = useMemo(() => (spec ? JSON.stringify(spec) : ''), [spec]);

  useEffect(() => {
    setRoute(null);
    setSaveMessage(null);
    if (!spec || contractErrors.length > 0) {
      setPreflight({ status: 'waiting' });
      return;
    }
    if (!window.metaspacer) {
      setPreflight({
        status: 'unavailable',
        message: 'Package preflight is available in the Electron desktop app.',
      });
      return;
    }

    let active = true;
    setPreflight({ status: 'checking' });
    const timer = window.setTimeout(() => {
      void window.metaspacer
        ?.preflightSpec(preflightPayload(spec, files))
        .then((result) => {
          if (active)
            setPreflight({
              status: 'complete',
              result: result as PreflightResult,
            });
        })
        .catch((reason: unknown) => {
          if (!active) return;
          const message =
            reason instanceof Error ? reason.message : 'R preflight failed.';
          setPreflight({
            status: 'unavailable',
            message: message.includes('metaspacer')
              ? 'The metaspacer R package is not available to the desktop app.'
              : message,
          });
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [contractErrors.length, files, spec, specJson]);

  const update = <Key extends keyof BuilderDraft>(
    key: Key,
    value: BuilderDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleFocal = (column: string, checked: boolean) => {
    const values = files.sampleMetadata?.values[column] ?? [];
    update(
      'focalVariables',
      checked
        ? [
            ...draft.focalVariables,
            {
              column,
              type: inferredType(values),
              referenceLevel: values.find(Boolean),
            },
          ]
        : draft.focalVariables.filter((entry) => entry.column !== column),
    );
  };

  const updateFocal = (
    column: string,
    patch: Partial<{ type: ColumnType; referenceLevel: string }>,
  ) => {
    update(
      'focalVariables',
      draft.focalVariables.map((entry) =>
        entry.column === column ? { ...entry, ...patch } : entry,
      ),
    );
  };

  const toggleTrait = (column: string, checked: boolean) => {
    update(
      'functionalTraits',
      checked
        ? [
            ...draft.functionalTraits,
            {
              column,
              type: inferredType(files.featureMetadata?.values[column] ?? []),
            },
          ]
        : draft.functionalTraits.filter((entry) => entry.column !== column),
    );
  };

  const save = async () => {
    if (!spec || !route) return;
    const content = `${JSON.stringify(spec, null, 2)}\n`;
    if (window.metaspacer) {
      const path = await window.metaspacer.saveSpec(content);
      if (path) setSaveMessage(`Saved ${path}`);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([content], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'model-spec.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveMessage('Downloaded model-spec.json');
  };

  const executeRoute = async () => {
    if (!spec || !route || !window.metaspacer) return;
    setRunnerBusy(true);
    setRunnerError(null);
    setExportedJob(null);
    try {
      const payload = preflightPayload(spec, files);
      if (route === 'local') {
        const started = await window.metaspacer.startLocalJob(payload);
        if (started) {
          activeJobId.current = started.id;
          setJob(started);
        }
      } else {
        const exported = await window.metaspacer.exportJob(payload);
        if (exported) setExportedJob(exported);
      }
    } catch (reason) {
      setRunnerError(
        reason instanceof Error
          ? reason.message
          : 'The runner operation could not be completed.',
      );
    } finally {
      setRunnerBusy(false);
    }
  };

  const cancelJob = async () => {
    if (!job || !window.metaspacer) return;
    await window.metaspacer.cancelJob(job.id);
  };

  const valid =
    preflight.status === 'complete' &&
    preflight.result.validation.valid &&
    preflight.result.cost;
  const fitsLocal = Boolean(
    valid && valid.estimatedMemoryMB <= draft.memorySoftLimitMB,
  );
  const builderStage =
    spec && contractErrors.length === 0 ? 3 : completeFiles(files) ? 2 : 1;
  const sampleColumns = files.sampleMetadata?.columns ?? [];
  const featureColumns = files.featureMetadata?.columns ?? [];
  const technicalColumns = [
    draft.completenessColumn,
    draft.contaminationColumn,
    draft.genomeSizeColumn,
  ];

  return (
    <div className="builder-shell">
      <header className="topbar builder-topbar">
        <button
          className="wordmark wordmark-button"
          type="button"
          onClick={onClose}
        >
          <span>meta</span>spacer
        </button>
        <div className="builder-progress" aria-label="Builder workflow">
          <span
            className={
              builderStage === 1 ? 'active' : builderStage > 1 ? 'complete' : ''
            }
          >
            1 Inputs
          </span>
          <span
            className={
              builderStage === 2 ? 'active' : builderStage > 2 ? 'complete' : ''
            }
          >
            2 Roles
          </span>
          <span className={builderStage === 3 ? 'active' : ''}>3 Gate</span>
        </div>
        <button className="outline-button" type="button" onClick={onClose}>
          Close builder
        </button>
      </header>

      <main className="builder-main">
        <section className="builder-hero">
          <div>
            <p className="eyebrow">M6 · Model design + runner</p>
            <h1>Build the recipe, then test the evidence.</h1>
          </div>
          <p>
            Inputs stay local. The same R package validation used before fitting
            checks IDs, roles, feature alignment, and compute cost here.
          </p>
        </section>

        <section className="builder-section" aria-labelledby="inputs-title">
          <div className="section-heading">
            <span>01</span>
            <div>
              <p className="eyebrow">Input data</p>
              <h2 id="inputs-title">Place the four sources</h2>
            </div>
          </div>
          <div className="input-grid">
            {(Object.keys(fileLabels) as InputRole[]).map((role) => (
              <InputCard
                key={role}
                role={role}
                file={files[role]}
                onFile={(inputRole, file) => void useFile(inputRole, file)}
                onRemove={removeFile}
              />
            ))}
          </div>
        </section>

        {completeFiles(files) ? (
          <>
            <section className="builder-section" aria-labelledby="roles-title">
              <div className="section-heading">
                <span>02</span>
                <div>
                  <p className="eyebrow">Role mapping</p>
                  <h2 id="roles-title">Tell each column what it means</h2>
                </div>
              </div>

              <div className="mapping-grid">
                <article className="mapping-card">
                  <h3>Sample alignment</h3>
                  <p>The two ID columns must identify the same sample set.</p>
                  <SelectField
                    label="Count-table sample ID"
                    value={draft.responseSampleId}
                    columns={files.countTable.columns}
                    onChange={(value) => update('responseSampleId', value)}
                  />
                  <SelectField
                    label="Metadata sample ID"
                    value={draft.metadataSampleId}
                    columns={sampleColumns}
                    onChange={(value) => update('metadataSampleId', value)}
                  />
                </article>

                <article className="mapping-card mapping-card-wide">
                  <h3>Focal conditions</h3>
                  <p>
                    Choose the environmental or host variables that define
                    condition space.
                  </p>
                  <ColumnChecks
                    columns={sampleColumns.filter(
                      (column) => column !== draft.metadataSampleId,
                    )}
                    selected={draft.focalVariables.map((entry) => entry.column)}
                    onToggle={toggleFocal}
                  />
                  {draft.focalVariables.map((entry) => (
                    <div className="typed-role" key={entry.column}>
                      <strong>{entry.column}</strong>
                      <select
                        value={entry.type}
                        onChange={(event) =>
                          updateFocal(entry.column, {
                            type: event.currentTarget.value as ColumnType,
                          })
                        }
                      >
                        <option value="continuous">Continuous</option>
                        <option value="categorical">Categorical</option>
                        <option value="binary">Binary</option>
                      </select>
                      {entry.type === 'categorical' ? (
                        <select
                          aria-label={`${entry.column} reference level`}
                          value={entry.referenceLevel ?? ''}
                          onChange={(event) =>
                            updateFocal(entry.column, {
                              referenceLevel: event.currentTarget.value,
                            })
                          }
                        >
                          <option value="">Reference level…</option>
                          {(files.sampleMetadata.values[entry.column] ?? [])
                            .filter(Boolean)
                            .map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                        </select>
                      ) : null}
                    </div>
                  ))}
                </article>

                <article className="mapping-card">
                  <h3>Feature identity & taxonomy</h3>
                  <p>
                    The feature ID aligns metadata and optional tree tips to
                    count columns.
                  </p>
                  <SelectField
                    label="Feature ID"
                    value={draft.featureId}
                    columns={featureColumns}
                    onChange={(value) => update('featureId', value)}
                  />
                  <span className="field-label">Taxonomy columns</span>
                  <ColumnChecks
                    columns={featureColumns.filter(
                      (column) => column !== draft.featureId,
                    )}
                    selected={draft.taxonomyColumns}
                    onToggle={(column, checked) =>
                      update(
                        'taxonomyColumns',
                        checked
                          ? [...draft.taxonomyColumns, column]
                          : draft.taxonomyColumns.filter(
                              (name) => name !== column,
                            ),
                      )
                    }
                  />
                </article>

                <article className="mapping-card">
                  <h3>Technical QC</h3>
                  <p>
                    These fields filter or adjust counts; they are not
                    ecological traits.
                  </p>
                  <SelectField
                    label="Completeness"
                    value={draft.completenessColumn}
                    columns={featureColumns}
                    onChange={(value) => update('completenessColumn', value)}
                  />
                  <SelectField
                    label="Contamination"
                    value={draft.contaminationColumn}
                    columns={featureColumns}
                    onChange={(value) => update('contaminationColumn', value)}
                  />
                  <SelectField
                    label="Genome size"
                    value={draft.genomeSizeColumn}
                    columns={featureColumns}
                    onChange={(value) => update('genomeSizeColumn', value)}
                  />
                  <div className="field-pair">
                    <label className="field">
                      <span>Min completeness %</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={draft.minimumCompleteness}
                        onChange={(event) =>
                          update(
                            'minimumCompleteness',
                            numberValue(event, draft.minimumCompleteness),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Max contamination %</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={draft.maximumContamination}
                        onChange={(event) =>
                          update(
                            'maximumContamination',
                            numberValue(event, draft.maximumContamination),
                          )
                        }
                      />
                    </label>
                  </div>
                </article>

                <article className="mapping-card mapping-card-wide">
                  <h3>Functional traits</h3>
                  <p>
                    Trait columns can modify focal responses through a
                    fourth-corner model. Technical QC remains excluded unless
                    genome size is explicitly dual-role.
                  </p>
                  <ColumnChecks
                    columns={featureColumns.filter(
                      (column) =>
                        column !== draft.featureId &&
                        !draft.taxonomyColumns.includes(column) &&
                        !technicalColumns.includes(column),
                    )}
                    selected={draft.functionalTraits.map(
                      (entry) => entry.column,
                    )}
                    onToggle={toggleTrait}
                  />
                  {draft.functionalTraits.map((entry) => (
                    <div className="typed-role" key={entry.column}>
                      <strong>{entry.column}</strong>
                      <select
                        value={entry.type}
                        onChange={(event) =>
                          update(
                            'functionalTraits',
                            draft.functionalTraits.map((trait) =>
                              trait.column === entry.column
                                ? {
                                    ...trait,
                                    type: event.currentTarget
                                      .value as ColumnType,
                                  }
                                : trait,
                            ),
                          )
                        }
                      >
                        <option value="continuous">Continuous</option>
                        <option value="categorical">Categorical</option>
                        <option value="binary">Binary</option>
                      </select>
                    </div>
                  ))}
                </article>
              </div>
            </section>

            <section className="builder-section" aria-labelledby="model-title">
              <div className="section-heading">
                <span>03</span>
                <div>
                  <p className="eyebrow">Model profile</p>
                  <h2 id="model-title">
                    Set the scientific and compute defaults
                  </h2>
                </div>
              </div>
              <div className="model-grid">
                <label className="field field-span-two">
                  <span>Design name</span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      update('name', event.currentTarget.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>Count family</span>
                  <select
                    value={draft.family}
                    onChange={(event) =>
                      update(
                        'family',
                        event.currentTarget.value as BuilderDraft['family'],
                      )
                    }
                  >
                    <option value="negative_binomial">Negative binomial</option>
                    <option value="zinb">Zero-inflated NB</option>
                  </select>
                </label>
                <label className="field">
                  <span>Latent variables</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={draft.latentVariables}
                    onChange={(event) =>
                      update(
                        'latentVariables',
                        numberValue(event, draft.latentVariables),
                      )
                    }
                  />
                </label>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={draft.usePhylogeny}
                    disabled={!files.phylogeneticTree}
                    onChange={(event) =>
                      update('usePhylogeny', event.currentTarget.checked)
                    }
                  />
                  <span>
                    <strong>Phylogenetic random effect</strong>
                    <small>
                      {files.phylogeneticTree
                        ? 'Use the supplied tree'
                        : 'Add a tree to enable'}
                    </small>
                  </span>
                </label>
                <label className="switch-field">
                  <input
                    type="checkbox"
                    checked={draft.fourthCornerEnabled}
                    disabled={draft.functionalTraits.length === 0}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setDraft((current) => ({
                        ...current,
                        fourthCornerEnabled: enabled,
                        fourthCornerFormula:
                          enabled && !current.fourthCornerFormula
                            ? `~ ${current.focalVariables[0]?.column ?? 'condition'} * (${current.functionalTraits.map((trait) => trait.column).join(' + ')})`
                            : current.fourthCornerFormula,
                      }));
                    }}
                  />
                  <span>
                    <strong>Fourth-corner traits</strong>
                    <small>Traits modify focal responses</small>
                  </span>
                </label>
                {draft.fourthCornerEnabled ? (
                  <label className="field field-span-two">
                    <span>Fourth-corner formula</span>
                    <input
                      value={draft.fourthCornerFormula}
                      onChange={(event) =>
                        update('fourthCornerFormula', event.currentTarget.value)
                      }
                    />
                  </label>
                ) : null}
                <label className="field">
                  <span>CPU threads</span>
                  <input
                    type="number"
                    min="1"
                    value={draft.cpuThreads}
                    onChange={(event) =>
                      update('cpuThreads', numberValue(event, draft.cpuThreads))
                    }
                  />
                </label>
                <label className="field">
                  <span>CPU affinity (optional)</span>
                  <input
                    value={cpuAffinityText}
                    placeholder="e.g. 0, 1, 2, 3"
                    inputMode="numeric"
                    pattern="[0-9, ]*"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (!/^[\d, ]*$/.test(value)) return;
                      setCpuAffinityText(value);
                      update('cpuAffinity', affinityValue(value));
                    }}
                  />
                </label>
                <label className="field">
                  <span>Soft memory limit (MB)</span>
                  <input
                    type="number"
                    min="256"
                    step="256"
                    value={draft.memorySoftLimitMB}
                    onChange={(event) =>
                      update(
                        'memorySoftLimitMB',
                        numberValue(event, draft.memorySoftLimitMB),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Monitored hard limit (optional MB)</span>
                  <input
                    type="number"
                    min={draft.memorySoftLimitMB}
                    step="256"
                    value={draft.memoryHardLimitMB ?? ''}
                    placeholder="No automatic stop"
                    onChange={(event) =>
                      update(
                        'memoryHardLimitMB',
                        event.currentTarget.value === ''
                          ? null
                          : numberValue(
                              event,
                              draft.memoryHardLimitMB ??
                                draft.memorySoftLimitMB,
                            ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Random seed</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.seed}
                    onChange={(event) =>
                      update('seed', numberValue(event, draft.seed))
                    }
                  />
                </label>
                <label className="field">
                  <span>Bundle output path</span>
                  <input
                    value={draft.outputPath}
                    onChange={(event) =>
                      update('outputPath', event.currentTarget.value)
                    }
                  />
                </label>
              </div>
            </section>

            <section
              className="builder-section gate-section"
              aria-labelledby="gate-title"
            >
              <div className="section-heading">
                <span>04</span>
                <div>
                  <p className="eyebrow">Validate & estimate gate</p>
                  <h2 id="gate-title">Run here or export?</h2>
                </div>
              </div>

              <div className="gate-panel">
                <div className="validation-summary" aria-live="polite">
                  {contractErrors.length > 0 ? (
                    <>
                      <span className="validation-icon invalid">!</span>
                      <div>
                        <strong>Complete the model specification</strong>
                        {contractErrors.slice(0, 4).map((message) => (
                          <p key={message}>{message}</p>
                        ))}
                      </div>
                    </>
                  ) : preflight.status === 'checking' ? (
                    <>
                      <span className="validation-icon checking" />
                      <div>
                        <strong>Checking with the R package…</strong>
                        <p>
                          IDs, roles, counts, traits, tree tips, and cost are
                          being evaluated.
                        </p>
                      </div>
                    </>
                  ) : preflight.status === 'unavailable' ? (
                    <>
                      <span className="validation-icon invalid">!</span>
                      <div>
                        <strong>Package preflight unavailable</strong>
                        <p>{preflight.message}</p>
                      </div>
                    </>
                  ) : preflight.status === 'complete' &&
                    !preflight.result.validation.valid ? (
                    <>
                      <span className="validation-icon invalid">!</span>
                      <div>
                        <strong>
                          {preflight.result.validation.errors.length} validation
                          issue(s)
                        </strong>
                        {preflight.result.validation.errors.map((issue) => (
                          <p key={`${issue.code}-${issue.path}`}>
                            {issue.message}
                          </p>
                        ))}
                      </div>
                    </>
                  ) : valid ? (
                    <>
                      <span className="validation-icon valid">✓</span>
                      <div>
                        <strong>Inputs and roles align</strong>
                        <p>
                          The gllvm preflight passed. No model has been fit.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="validation-icon">·</span>
                      <div>
                        <strong>Waiting for a complete design</strong>
                        <p>
                          Add the three required tables and map their roles.
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {valid ? (
                  <>
                    <dl className="cost-strip">
                      <div>
                        <dt>Samples</dt>
                        <dd>{valid.samples}</dd>
                      </div>
                      <div>
                        <dt>Responses</dt>
                        <dd>{valid.responses}</dd>
                      </div>
                      <div>
                        <dt>Estimated memory</dt>
                        <dd>{valid.estimatedMemoryMB} MB</dd>
                      </div>
                      <div>
                        <dt>Runtime range</dt>
                        <dd>
                          {formatDuration(valid.estimatedRuntimeSeconds.lower)}–
                          {formatDuration(valid.estimatedRuntimeSeconds.upper)}
                        </dd>
                      </div>
                    </dl>
                    <p className="cost-guidance">{valid.guidance}</p>
                    <div className="route-grid">
                      <button
                        className={route === 'local' ? 'selected' : ''}
                        type="button"
                        onClick={() => setRoute('local')}
                      >
                        <span>Run here{fitsLocal ? ' · Recommended' : ''}</span>
                        <strong>Use this machine</strong>
                        <small>
                          Recommended when the estimate fits the configured
                          resources.
                        </small>
                      </button>
                      <button
                        className={route === 'export' ? 'selected' : ''}
                        type="button"
                        onClick={() => setRoute('export')}
                      >
                        <span>Export{fitsLocal ? '' : ' · Recommended'}</span>
                        <strong>Prepare a remote job</strong>
                        <small>
                          Choose this for larger inputs or managed compute.
                        </small>
                      </button>
                    </div>
                    <div className="gate-actions">
                      <p>
                        Both routes use the same package entry point and exact
                        input bytes.
                      </p>
                      <button
                        className="outline-button"
                        type="button"
                        disabled={!route || runnerBusy}
                        onClick={() => void save()}
                      >
                        Save spec only
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={
                          !route ||
                          runnerBusy ||
                          job?.status === 'queued' ||
                          job?.status === 'running'
                        }
                        onClick={() => void executeRoute()}
                      >
                        {runnerBusy
                          ? 'Preparing…'
                          : route === 'local'
                            ? 'Start local run'
                            : route === 'export'
                              ? 'Export portable job'
                              : 'Choose a route'}
                      </button>
                    </div>
                    {saveMessage ? (
                      <p className="save-message">{saveMessage}</p>
                    ) : null}
                    {runnerError ? (
                      <p className="runner-error" role="alert">
                        {runnerError}
                      </p>
                    ) : null}
                    {exportedJob ? (
                      <div className="runner-result" aria-live="polite">
                        <span className="validation-icon valid">✓</span>
                        <div>
                          <strong>Portable job exported</strong>
                          <p>{exportedJob.path}</p>
                          <small>
                            Includes exact inputs, package source, manifest,
                            launchers, and renv.lock.
                          </small>
                        </div>
                      </div>
                    ) : null}
                    {job ? (
                      <div
                        className={`job-monitor job-${job.status}`}
                        aria-live="polite"
                      >
                        <div className="job-monitor-heading">
                          <div>
                            <span>{job.status}</span>
                            <strong>{job.name}</strong>
                          </div>
                          {job.status === 'queued' ||
                          job.status === 'running' ? (
                            <button
                              className="outline-button"
                              type="button"
                              onClick={() => void cancelJob()}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                        <dl>
                          <div>
                            <dt>CPU</dt>
                            <dd>
                              {job.telemetry
                                ? `${job.telemetry.cpuPercent.toFixed(1)}%`
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>RSS</dt>
                            <dd>
                              {job.telemetry
                                ? formatBytes(job.telemetry.rssBytes)
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Peak RSS</dt>
                            <dd>
                              {job.telemetry
                                ? formatBytes(job.telemetry.peakRssBytes)
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Thread budget</dt>
                            <dd>
                              {job.requestedCpuThreads} / {job.cpuBudget}
                            </dd>
                          </div>
                        </dl>
                        <p
                          className={
                            job.telemetry?.softLimitExceeded
                              ? 'memory-warning'
                              : ''
                          }
                        >
                          {job.queuePosition
                            ? `Queue position ${job.queuePosition}. `
                            : ''}
                          {job.message}
                        </p>
                        {job.outputPath ? (
                          <small>Bundle: {job.outputPath}</small>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
