import './style.css';
import { parseGhostExport, type NormalizedEntry, type SkippedEntry } from './parser';
import { buildDocumentsAsync, type SetDocumentOutcome } from './pipeline';
import { buildExportZip, type ZipDocument } from './zip';
import { downloadBlob } from './download';
import { resetOutputState } from './export-state';
import { computeSelection, type SelectionMode } from './selection';
import { fetchContentApiEntries } from './content-api';
import type { FrontMatterKey } from './frontmatter';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Front matter fields exposed to the user, in canonical output order. */
const FRONT_MATTER_FIELDS: Array<{ key: FrontMatterKey; label: string }> = [
  { key: 'title', label: 'title' },
  { key: 'slug', label: 'slug' },
  { key: 'date', label: 'date' },
  { key: 'updated', label: 'updated' },
  { key: 'author', label: 'author' },
  { key: 'tags', label: 'tags' },
  { key: 'canonicalUrl', label: 'canonical_url' },
];

interface UiState {
  entries: NormalizedEntry[];
  skipped: SkippedEntry[];
  /** Ordered ids of entries that produced a successful document this run. */
  successIds: string[];
  /** Successful conversions, keyed by entry id. */
  documents: Map<string, { type: 'post' | 'page'; filename: string; markdown: string }>;
  /** Selected entry ids (persisted across search filtering). */
  selectedIds: Set<string>;
  /** Live search term matching title or slug. */
  searchTerm: string;
  converting: boolean;
}

/**
 * The seam the browser smoke tests drive. Every method is a thin wrapper over
 * the same DOM event handlers a user triggers, so tests exercise the real
 * Upload -> Select -> Convert -> Preview flow rather than a mock.
 */
export interface AppApi {
  /** Upload path: accepts raw export JSON exactly like choosing a file. */
  loadExportText(text: string): Promise<void>;
  /** Upload path with an explicit byte size (defaults to the text length). */
  loadExportTextWithSize(text: string, size: number): Promise<void>;
  /** Currently selected entry ids. */
  selectedIds(): string[];
  /** Replaces the selection over the visible rows using a preset mode. */
  applySelection(mode: SelectionMode): void;
  /** Sets the search term and re-renders the entry list. */
  search(term: string): void;
  /** Visible entry rows currently rendered. */
  visibleRows(): Array<{ id: string; title: string; type: string; status: string }>;
  /** Runs conversion of the current selection; resolves with the outcomes. */
  convert(): Promise<SetDocumentOutcome[]>;
  /** Clicks the first result row's filename button and returns the preview. */
  previewFirst(): string;
  /** Filenames shown in the results list. */
  resultFilenames(): string[];
  /** Successful conversions keyed by entry id. */
  documents(): ReadonlyMap<string, { type: 'post' | 'page'; filename: string; markdown: string }>;
  /** The status/summary line under the results. */
  note(): string;
  /** Fetches public entries via the Content API form with an injected fetch. */
  fetchApi(opts: { origin: string; key: string; type: 'post' | 'page'; fetchImpl?: typeof fetch }): Promise<boolean>;
  /** Front matter controls (tests toggle them like a user would). */
  frontMatter: {
    enabled(): boolean;
    setEnabled(enabled: boolean): void;
    fieldEnabled(key: FrontMatterKey): boolean;
    setField(key: FrontMatterKey, enabled: boolean): void;
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

function setText(node: Element, text: string): void {
  node.textContent = text;
}

/**
 * Builds the complete single-page application inside `container` and returns a
 * test seam over the real event handlers. When imported as the SPA entry this
 * is called once with `#app`; tests call it with their own detached container.
 */
export function createApp(container: HTMLElement): AppApi {
  const app = container;

  const state: UiState = {
    entries: [],
    skipped: [],
    successIds: [],
    documents: new Map(),
    selectedIds: new Set(),
    searchTerm: '',
    converting: false,
  };

  // -------------------------------------------------------------------------
  // DOM nodes
  // -------------------------------------------------------------------------
  const fileInput = el('input');
  const message = el('p');
  const apiOrigin = el('input');
  const apiKey = el('input');
  const apiType = el('select');
  const apiButton = el('button');
  const apiMessage = el('p');
  const searchInput = el('input');
  const entryList = el('div');
  const progress = el('progress');
  const progressStatus = el('p');
  const convertButton = el('button');
  const results = el('div');
  const downloadZipButton = el('button');
  const preview = el('pre');
  const note = el('p');
  const fmEnabled = el('input');
  const fmFieldInputs = new Map<FrontMatterKey, HTMLInputElement>();

  // -------------------------------------------------------------------------
  // Step 1: upload
  // -------------------------------------------------------------------------
  function buildUploadForm(): void {
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.id = 'export-file';
    const uploadLabel = el('label');
    uploadLabel.htmlFor = 'export-file';
    uploadLabel.textContent = '1. Choose a Ghost JSON export:';
    const privacy = el('p');
    privacy.className = 'privacy';
    privacy.textContent =
      'Everything runs locally in your browser — your export is never uploaded.';
    app.append(uploadLabel, fileInput, privacy, buildApiSection(), message);
  }

  /**
   * Secondary import path: public posts/pages via the Ghost Content API using
   * a public Content API key. Entirely client-side; the key is sent only to
   * the Ghost site itself and never stored.
   */
  function buildApiSection(): HTMLElement {
    const details = el('details');
    details.className = 'api';
    const summary = el('summary');
    summary.textContent = 'Or fetch public posts/pages from a Ghost Content API';
    details.append(summary);

    const form = el('div');
    form.className = 'api-form';

    const originLabel = el('label');
    originLabel.textContent = 'Site address (https://…)';
    originLabel.htmlFor = 'api-origin';
    apiOrigin.type = 'url';
    apiOrigin.id = 'api-origin';
    apiOrigin.placeholder = 'https://example.com';
    apiOrigin.autocomplete = 'off';
    apiOrigin.required = true;

    const keyLabel = el('label');
    keyLabel.textContent = 'Public Content API key (id:secret)';
    keyLabel.htmlFor = 'api-key';
    apiKey.type = 'password';
    apiKey.id = 'api-key';
    apiKey.autocomplete = 'off';
    apiKey.required = true;
    const keyHint = el('p');
    keyHint.className = 'hint';
    keyHint.textContent =
      'Found in Ghost Admin -> Settings -> Integrations. Only public posts or pages are fetched.';

    const typeLabel = el('label');
    typeLabel.textContent = 'Resource';
    typeLabel.htmlFor = 'api-type';
    apiType.id = 'api-type';
    const postsOption = el('option');
    postsOption.value = 'post';
    postsOption.textContent = 'Posts';
    const pagesOption = el('option');
    pagesOption.value = 'page';
    pagesOption.textContent = 'Pages';
    apiType.append(postsOption, pagesOption);

    apiButton.type = 'button';
    apiButton.textContent = 'Fetch public entries';
    apiMessage.className = 'hint';
    apiMessage.setAttribute('role', 'status');

    form.append(
      originLabel, apiOrigin,
      keyLabel, apiKey, keyHint,
      typeLabel, apiType,
      apiButton, apiMessage,
    );
    details.append(form);
    return details;
  }

  // -------------------------------------------------------------------------
  // Step 2: select
  // -------------------------------------------------------------------------
  function buildSelectStep(): void {
    const heading = el('h2');
    heading.textContent = '2. Select entries to convert';

    const toolbar = el('div');
    toolbar.className = 'toolbar';

    searchInput.type = 'search';
    searchInput.placeholder = 'Search by title or slug…';
    searchInput.className = 'search';
    searchInput.addEventListener('input', () => {
      state.searchTerm = searchInput.value.trim().toLowerCase();
      renderEntries();
    });

    const selectAll = el('button');
    selectAll.type = 'button';
    setText(selectAll, 'Select all');
    selectAll.addEventListener('click', () => applySelection('all'));

    const selectNone = el('button');
    selectNone.type = 'button';
    setText(selectNone, 'Select none');
    selectNone.addEventListener('click', () => applySelection('none'));

    const selectPublished = el('button');
    selectPublished.type = 'button';
    setText(selectPublished, 'Published');
    selectPublished.addEventListener('click', () => applySelection('published'));

    const selectDrafts = el('button');
    selectDrafts.type = 'button';
    setText(selectDrafts, 'Drafts');
    selectDrafts.addEventListener('click', () => applySelection('drafts'));

    toolbar.append(searchInput, selectAll, selectNone, selectPublished, selectDrafts);

    progress.className = 'progress';
    progressStatus.className = 'hint';
    progress.hidden = true;
    progressStatus.hidden = true;

    convertButton.type = 'button';
    convertButton.textContent = 'Convert selected';
    convertButton.disabled = true;
    entryList.className = 'entry-list';

    app.append(heading, toolbar, buildOutputOptions(), entryList, progress, progressStatus, convertButton, note);
  }

  /** Front matter toggle and field picker feeding DocumentOptions. */
  function buildOutputOptions(): HTMLElement {
    const details = el('details');
    details.className = 'output-options';

    const summary = el('summary');
    summary.textContent = 'Output options: front matter';
    details.append(summary);

    const panel = el('div');
    panel.className = 'api-form';

    const toggleLabel = el('label');
    toggleLabel.className = 'row';
    fmEnabled.type = 'checkbox';
    fmEnabled.checked = true;
    fmEnabled.id = 'fm-enabled';
    toggleLabel.htmlFor = 'fm-enabled';
    const toggleText = el('span');
    toggleText.textContent = 'Include YAML front matter';
    toggleLabel.append(fmEnabled, ' ', toggleText);

    const fieldsLabel = el('span');
    fieldsLabel.className = 'hint';
    fieldsLabel.textContent = 'Fields:';

    const fields = el('div');
    fields.className = 'fm-fields';

    for (const { key, label } of FRONT_MATTER_FIELDS) {
      const fieldLabel = el('label');
      fieldLabel.className = 'row';
      const input = el('input');
      input.type = 'checkbox';
      input.checked = true;
      input.value = key;
      fieldLabel.append(input, ' ', label);
      fmFieldInputs.set(key, input);
      fields.append(fieldLabel);
    }

    const syncFieldsDisabled = (): void => {
      for (const input of fmFieldInputs.values()) input.disabled = !fmEnabled.checked;
    };
    fmEnabled.addEventListener('change', syncFieldsDisabled);
    syncFieldsDisabled();

    panel.append(toggleLabel, fieldsLabel, fields);
    details.append(panel);
    return details;
  }

  // -------------------------------------------------------------------------
  // Step 3: results
  // -------------------------------------------------------------------------
  function buildResultsStep(): void {
    const heading = el('h2');
    heading.textContent = '3. Converted results';

    downloadZipButton.type = 'button';
    downloadZipButton.className = 'zip';
    downloadZipButton.textContent = 'Download ZIP';
    downloadZipButton.disabled = true;
    downloadZipButton.addEventListener('click', () => void downloadZip());

    const previewHeading = el('h2');
    previewHeading.textContent = 'Preview';
    preview.className = 'preview';
    preview.id = 'preview';
    const download = el('p');
    download.className = 'hint';
    download.textContent = 'Click a result to preview it, or download its .md file.';
    results.className = 'results';
    app.append(heading, results, downloadZipButton, previewHeading, preview, download);
  }

  // -------------------------------------------------------------------------
  // Selection helpers
  // -------------------------------------------------------------------------
  function visibleEntries(): NormalizedEntry[] {
    if (!state.searchTerm) return state.entries;
    return state.entries.filter(
      (e) =>
        e.title.toLowerCase().includes(state.searchTerm) ||
        e.slug.toLowerCase().includes(state.searchTerm),
    );
  }

  function refreshSelectionState(): void {
    state.converting = false;
    renderEntries();
    convertButton.disabled = state.selectedIds.size === 0;
  }

  /**
   * Applies a replacement selection operation over the currently visible
   * (search-matched) rows. Each preset replaces the selection rather than
   * accumulating into it.
   */
  function applySelection(mode: SelectionMode): void {
    state.selectedIds = computeSelection(visibleEntries(), mode);
    refreshSelectionState();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  function renderEntries(): void {
    entryList.replaceChildren();
    const visible = visibleEntries();

    for (const entry of visible) {
      const label = el('label');
      label.className = 'entry-row';
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.value = entry.id;
      checkbox.checked = state.selectedIds.has(entry.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedIds.add(entry.id);
        else state.selectedIds.delete(entry.id);
        convertButton.disabled = state.selectedIds.size === 0;
      });

      const meta = el('span');
      meta.className = 'meta';
      const author = entry.authors.length ? entry.authors.join(', ') : '—';
      const date = entry.publishedAt ?? '—';
      setText(meta, `${entry.type} · ${entry.status} · ${author} · ${date} · ${entry.slug}`);

      const title = el('strong');
      setText(title, entry.title || '(untitled)');

      label.append(checkbox, title, ' ', meta);
      entryList.append(label);
    }

    if (visible.length === 0) {
      const empty = el('p');
      empty.className = 'empty';
      setText(
        empty,
        state.entries.length === 0
          ? 'No posts or pages were found in this export.'
          : 'No entries match your search.',
      );
      entryList.append(empty);
    }

    if (state.skipped.length > 0) {
      const skippedNote = el('p');
      skippedNote.className = 'warn';
      setText(
        skippedNote,
        `${state.skipped.length} unsupported entry/entries skipped (only posts and pages are converted).`,
      );
      entryList.append(skippedNote);
    }
  }

  function renderResults(outcomes: SetDocumentOutcome[]): void {
    results.replaceChildren();
    state.successIds = [];
    state.documents.clear();
    downloadZipButton.disabled = true;

    for (const doc of outcomes) {
      const row = el('div');
      row.className = 'result-row';
      const entry = state.entries.find((e) => e.id === doc.entryId);

      if (!doc.ok || entry === undefined) {
        const err = el('span');
        setText(
          err,
          `Could not convert “${entry?.title ?? 'entry'}”: ${doc.ok ? '' : doc.error.message}`,
        );
        row.append(err);
        results.append(row);
        continue;
      }

      state.successIds.push(doc.entryId);
      state.documents.set(doc.entryId, {
        type: entry.type,
        filename: doc.filename,
        markdown: doc.markdown,
      });

      const filenameButton = el('button');
      filenameButton.className = 'filename';
      filenameButton.type = 'button';
      setText(filenameButton, doc.filename);
      filenameButton.addEventListener('click', () => {
        // textContent keeps the preview safe: no HTML is ever injected.
        setText(preview, doc.markdown);
      });

      const warnings = el('span');
      warnings.className = 'warn';
      setText(warnings, doc.warnings.length ? doc.warnings.join(' ') : '');

      const download = el('button');
      download.type = 'button';
      setText(download, 'Download');
      download.addEventListener('click', () => {
        downloadBlob(new Blob([doc.markdown], { type: 'text/markdown' }), doc.filename);
      });

      row.append(filenameButton, warnings, download);
      results.append(row);
    }

    if (state.successIds.length > 0) downloadZipButton.disabled = false;
    setText(note, `${state.successIds.length} converted, ${outcomes.length - state.successIds.length} failed.`);
  }

  async function convertSelected(): Promise<SetDocumentOutcome[]> {
    results.replaceChildren();
    downloadZipButton.disabled = true;

    const selected = state.entries.filter((e) => state.selectedIds.has(e.id));
    if (selected.length === 0) return [];

    state.converting = true;
    convertButton.disabled = true;
    progress.hidden = false;
    progressStatus.hidden = false;
    progress.max = selected.length;
    progress.value = 0;
    setText(progressStatus, `Converting 0 / ${selected.length}…`);

    const fields = FRONT_MATTER_FIELDS
      .filter(({ key }) => fmFieldInputs.get(key)?.checked)
      .map(({ key }) => key);
    const options = {
      frontMatter: fmEnabled.checked,
      fields: fields.length === FRONT_MATTER_FIELDS.length ? undefined : fields,
    };

    try {
      const outcomes = await buildDocumentsAsync(selected, {
        ...options,
        onProgress: (p) => {
          progress.value = p.processed;
          setText(progressStatus, `Converting ${p.processed} / ${p.total}…`);
        },
      });
      renderResults(outcomes);
      setText(
        progressStatus,
        `Done. ${state.successIds.length} converted, ${selected.length - state.successIds.length} failed.`,
      );
      return outcomes;
    } finally {
      state.converting = false;
      // Allow re-running the same selection, or a new one, afterwards.
      convertButton.disabled = state.selectedIds.size === 0;
    }
  }

  async function downloadZip(): Promise<void> {
    const docs: ZipDocument[] = state.entries
      .filter((e) => state.documents.has(e.id))
      .map((e) => {
        const doc = state.documents.get(e.id)!;
        return { entryId: e.id, type: doc.type, filename: doc.filename, markdown: doc.markdown };
      });
    if (docs.length === 0) return;
    const blob = await buildExportZip(docs);
    downloadBlob(blob, 'ghost-markdown-export.zip');
  }

  // -------------------------------------------------------------------------
  // Content API handling
  // -------------------------------------------------------------------------
  async function handleApiFetch(fetchImpl?: typeof fetch): Promise<boolean> {
    apiMessage.className = 'hint';
    setText(apiMessage, '');

    const origin = apiOrigin.value.trim();
    const key = apiKey.value.trim();

    if (!origin || !key) {
      apiMessage.className = 'error';
      setText(apiMessage, 'Enter both the site address and the public Content API key.');
      return false;
    }

    apiButton.disabled = true;
    setText(apiButton, 'Fetching…');
    try {
      const outcome = await fetchContentApiEntries({
        origin,
        key,
        type: apiType.value === 'page' ? 'page' : 'post',
        fetchImpl,
      });

      if (!outcome.ok) {
        apiMessage.className = 'error';
        setText(apiMessage, outcome.error.message);
        return false;
      }

      state.entries = outcome.entries;
      state.skipped = [];
      resetOutputState(state);
      searchInput.value = '';
      results.replaceChildren();
      downloadZipButton.disabled = true;
      setText(preview, '');
      progress.hidden = true;
      progressStatus.hidden = true;

      const summary = `${state.entries.length} public ${apiType.value === 'page' ? 'pages' : 'posts'} fetched.`;
      setText(note, outcome.warnings.length ? `${summary} ${outcome.warnings.join(' ')}` : summary);
      convertButton.disabled = true;
      renderEntries();
      apiMessage.className = 'hint';
      setText(apiMessage, summary);
      return true;
    } finally {
      apiButton.disabled = false;
      setText(apiButton, 'Fetch public entries');
    }
  }

  // -------------------------------------------------------------------------
  // Upload handling
  // -------------------------------------------------------------------------
  async function handleFile(file: File): Promise<void> {
    message.className = '';
    setText(message, '');

    if (file.size > MAX_FILE_BYTES) {
      message.className = 'error';
      setText(message, `This export is too large. The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
      return;
    }

    const text = await file.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      message.className = 'error';
      setText(message, 'This file is not valid JSON. Download the export again from Ghost.');
      return;
    }

    const outcome = parseGhostExport(parsed);
    if (!outcome.ok) {
      message.className = 'error';
      setText(message, outcome.error.message);
      return;
    }

    state.entries = outcome.entries;
    state.skipped = outcome.skipped;

    // A new export must never inherit a previous run's state: clear the selection,
    // any prior documents/results, the search, and the busy flag so old files
    // cannot stay downloadable or be paired with the new entries' ids.
    resetOutputState(state);
    searchInput.value = '';
    results.replaceChildren();
    downloadZipButton.disabled = true;
    setText(preview, '');
    progress.hidden = true;
    progressStatus.hidden = true;

    setText(note, `${state.entries.length} posts or pages parsed.`);
    convertButton.disabled = true;
    renderEntries();
  }

  // -------------------------------------------------------------------------
  // Wire up
  // -------------------------------------------------------------------------
  buildUploadForm();
  buildSelectStep();
  buildResultsStep();
  note.setAttribute('aria-live', 'polite');
  progressStatus.setAttribute('aria-live', 'polite');
  message.setAttribute('role', 'status');
  apiButton.addEventListener('click', () => void handleApiFetch());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void handleFile(file);
  });
  convertButton.addEventListener('click', () => void convertSelected());

  // -------------------------------------------------------------------------
  // Test seam (thin wrappers over the real handlers above)
  // -------------------------------------------------------------------------
  return {
    async loadExportText(text: string): Promise<void> {
      await handleFile({ size: text.length, text: async () => text } as unknown as File);
    },
    async loadExportTextWithSize(text: string, size: number): Promise<void> {
      await handleFile({ size, text: async () => text } as unknown as File);
    },
    selectedIds(): string[] {
      return [...state.selectedIds];
    },
    applySelection(mode: SelectionMode): void {
      applySelection(mode);
    },
    search(term: string): void {
      searchInput.value = term;
      state.searchTerm = term.trim().toLowerCase();
      renderEntries();
    },
    visibleRows() {
      return [...entryList.querySelectorAll<HTMLLabelElement>('.entry-row')].map((row) => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const title = row.querySelector('strong');
        const meta = row.querySelector('.meta');
        const metaText = meta?.textContent ?? '';
        const [, status] = metaText.split(' · ');
        return {
          id: checkbox?.getAttribute('value') ?? '',
          title: title?.textContent ?? '',
          type: metaText.split(' · ')[0] ?? '',
          status: status ?? '',
        };
      });
    },
    async convert(): Promise<SetDocumentOutcome[]> {
      return convertSelected();
    },
    previewFirst(): string {
      const first = results.querySelector<HTMLButtonElement>('button.filename');
      if (!first) return '';
      first.click();
      return preview.textContent ?? '';
    },
    resultFilenames(): string[] {
      return [...results.querySelectorAll<HTMLButtonElement>('button.filename')].map(
        (b) => b.textContent ?? '',
      );
    },
    documents(): ReadonlyMap<string, { type: 'post' | 'page'; filename: string; markdown: string }> {
      return state.documents;
    },
    note(): string {
      return note.textContent ?? '';
    },
    async fetchApi(opts): Promise<boolean> {
      apiOrigin.value = opts.origin;
      apiKey.value = opts.key;
      apiType.value = opts.type;
      return handleApiFetch(opts.fetchImpl);
    },
    frontMatter: {
      enabled(): boolean {
        return fmEnabled.checked;
      },
      setEnabled(enabled: boolean): void {
        fmEnabled.checked = enabled;
        fmEnabled.dispatchEvent(new Event('change', { bubbles: true }));
      },
      fieldEnabled(key: FrontMatterKey): boolean {
        return fmFieldInputs.get(key)?.checked ?? false;
      },
      setField(key: FrontMatterKey, enabled: boolean): void {
        const input = fmFieldInputs.get(key);
        if (input) input.checked = enabled;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// SPA bootstrap. Guarded so tests can import this module (and the worker-safe
// sibling modules) without requiring a mounted `#app`.
// ---------------------------------------------------------------------------
const root = document.querySelector<HTMLDivElement>('#app');
if (root) createApp(root);
