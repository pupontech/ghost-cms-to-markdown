import {
  parseGhostExportText,
  type ImportOutcome,
  type NormalizedEntry,
  type SkippedEntry,
} from './parser';
import { createWorkerHost } from './worker-host';
import { buildDocumentsAsync, type SetDocumentOutcome } from './pipeline';
import { buildExportZip, type ZipDocument } from './zip';
import { downloadBlob } from './download';
import { resetOutputState } from './export-state';
import { computeSelection, type SelectionMode } from './selection';
import type { FrontMatterKey } from './frontmatter';
import type { WorkerLike } from './worker-host';

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

/** Optional seams used by browser smoke tests; production uses the real worker. */
export interface AppOptions {
  workerFactory?: () => WorkerLike;
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
  /** Front matter controls (tests toggle them like a user would). */
  frontMatter: {
    enabled(): boolean;
    setEnabled(enabled: boolean): void;
    fieldEnabled(key: FrontMatterKey): boolean;
    setField(key: FrontMatterKey, enabled: boolean): void;
  };
  /** Theme control: explicit light or dark mode. */
  theme: {
    set(theme: 'light' | 'dark'): void;
    current(): 'light' | 'dark';
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
export function createApp(container: HTMLElement, appOptions: AppOptions = {}): AppApi {
  const app = container;
  app.classList.add('app-shell');

  const state: UiState = {
    entries: [],
    skipped: [],
    successIds: [],
    documents: new Map(),
    selectedIds: new Set(),
    searchTerm: '',
    converting: false,
  };
  let exportGeneration = 0;
  // Invalidates every asynchronous conversion when a new export or run starts.
  let activeRunToken = 0;
  // Theme preference is an explicit light/dark choice and is never persisted.
  let themePreference: 'light' | 'dark' = 'dark';

  async function parseExportText(text: string): Promise<ImportOutcome> {
    const host = createWorkerHost(appOptions.workerFactory);
    try {
      if (host.supported) {
        const outcome = await host.parse(text);
        if (outcome !== null) return outcome;
      }
    } catch {
      // Fall through to the main-thread parser.
    } finally {
      host.dispose();
    }
    return parseGhostExportText(text);
  }

  // -------------------------------------------------------------------------
  // DOM nodes
  // -------------------------------------------------------------------------
  const fileInput = el('input');
  const message = el('p');
  const searchInput = el('input');
  const entryList = el('div');
  const progress = el('progress');
  const progressStatus = el('p');
  const convertButton = el('button');
  const results = el('div');
  const downloadZipButton = el('button');
  const preview = el('pre');
  const note = el('p');
  note.className = 'hint result-note';
  const fmEnabled = el('input');
  const fmFieldInputs = new Map<FrontMatterKey, HTMLInputElement>();

  // -------------------------------------------------------------------------
  // Intro + step 1: upload
  // -------------------------------------------------------------------------
  function buildIntro(): void {
    const header = el('header');
    header.className = 'app-header';

    const themeToggle = el('button');
    themeToggle.type = 'button';
    themeToggle.className = 'theme-toggle';

    const applyTheme = (theme: 'light' | 'dark'): void => {
      themePreference = theme;
      document.documentElement.setAttribute('data-theme', theme);
      setText(themeToggle, `Theme: ${theme}`);
    };

    const toggleTheme = (): void => {
      applyTheme(themePreference === 'dark' ? 'light' : 'dark');
    };

    themeToggle.addEventListener('click', toggleTheme);
    applyTheme('dark');

    const eyebrow = el('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'LOCAL EXPORT TOOL';

    const title = el('h1');
    title.textContent = 'Ghost CMS to Markdown';

    const subtitle = el('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Turn a Ghost JSON export into clean, portable Markdown.';

    const privacyBadge = el('div');
    privacyBadge.className = 'privacy-badge';
    privacyBadge.setAttribute('role', 'status');
    const dot = el('span');
    dot.className = 'privacy-dot';
    dot.setAttribute('aria-hidden', 'true');
    const badgeText = el('span');
    badgeText.textContent = 'Browser-local · no credentials · no upload';
    privacyBadge.append(dot, badgeText);

    header.append(eyebrow, title, subtitle, privacyBadge, themeToggle);
    app.append(header);
  }

  function buildUploadForm(): void {
    const section = el('section');
    section.className = 'panel step-card';

    const heading = el('h2');
    heading.className = 'step-title';
    heading.textContent = '1. Open a Ghost JSON export';

    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.id = 'export-file';
    fileInput.className = 'file-input';
    const uploadLabel = el('label');
    uploadLabel.htmlFor = 'export-file';
    uploadLabel.className = 'field-label';
    uploadLabel.textContent = 'Choose the export file from Ghost Admin';
    const privacy = el('p');
    privacy.className = 'privacy-callout';
    privacy.textContent =
      'Runs entirely in your browser. No login, password, token, or API key is requested, stored, or sent.';

    section.append(heading, uploadLabel, fileInput, privacy, message);
    app.append(section);
  }

  // -------------------------------------------------------------------------
  // Step 2: select
  // -------------------------------------------------------------------------
  function buildSelectStep(): void {
    const section = el('section');
    section.className = 'panel step-card';

    const heading = el('h2');
    heading.className = 'step-title';
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
    progressStatus.className = 'hint progress-status';
    progress.hidden = true;
    progressStatus.hidden = true;

    convertButton.type = 'button';
    convertButton.className = 'primary';
    convertButton.textContent = 'Convert selected';
    convertButton.disabled = true;
    entryList.className = 'entry-list';
    entryList.hidden = true;

    section.append(heading, toolbar, buildOutputOptions(), entryList, progress, progressStatus, convertButton, note);
    app.append(section);
  }

  /** Front matter toggle and field picker feeding DocumentOptions. */
  function buildOutputOptions(): HTMLElement {
    const details = el('details');
    details.className = 'output-options';

    const summary = el('summary');
    summary.textContent = 'Output options: front matter';
    details.append(summary);

    const panel = el('div');
    panel.className = 'options-form';

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
    const section = el('section');
    section.className = 'panel step-card';

    const heading = el('h2');
    heading.className = 'step-title';
    heading.textContent = '3. Converted results';

    downloadZipButton.type = 'button';
    downloadZipButton.className = 'zip download-all';
    downloadZipButton.textContent = 'Download all';
    downloadZipButton.setAttribute('aria-label', 'Download all converted entries as a ZIP');
    downloadZipButton.disabled = true;
    downloadZipButton.addEventListener('click', () => void downloadZip());

    const resultsToolbar = el('div');
    resultsToolbar.className = 'results-toolbar';
    resultsToolbar.append(downloadZipButton);

    const previewHeading = el('h2');
    previewHeading.className = 'subheading';
    previewHeading.textContent = 'Preview';
    preview.className = 'preview';
    preview.id = 'preview';
    const download = el('p');
    download.className = 'hint';
    download.textContent = 'Click a result to preview it, or download its .md file.';
    results.className = 'results';
    section.append(heading, resultsToolbar, results, previewHeading, preview, download);
    app.append(section);
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
    entryList.hidden = false;
    entryList.replaceChildren();
    const visible = visibleEntries();

    const buildRow = (entry: NormalizedEntry): HTMLLabelElement => {
      const label = el('label');
      label.className = 'entry-row';
      label.dataset.entryType = entry.type;
      label.dataset.entryStatus = entry.status;
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
      const date = entry.publishedAt ?? '—';
      setText(meta, date);

      const title = el('strong');
      setText(title, entry.title || '(untitled)');

      label.append(checkbox, title, ' ', meta);
      return label;
    };

    const visibleRows = visible.slice(0, 8).map(buildRow);
    entryList.append(...visibleRows);

    if (visible.length > 8) {
      const overflow = el('details');
      overflow.className = 'entry-overflow';
      const summary = el('summary');
      setText(summary, `Show ${visible.length - 8} more…`);
      overflow.append(summary);
      for (const entry of visible.slice(8)) overflow.append(buildRow(entry));
      entryList.append(overflow);
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
        `${state.skipped.length} ${state.skipped.length === 1 ? 'entry' : 'entries'} skipped during import.`,
      );
      entryList.append(skippedNote);
    }
  }

  function renderResults(outcomes: SetDocumentOutcome[]): void {
    results.replaceChildren();
    state.successIds = [];
    state.documents.clear();
    downloadZipButton.disabled = true;

    const buildRow = (doc: SetDocumentOutcome): HTMLElement => {
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
        return row;
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
      return row;
    };

    const firstRows = outcomes.slice(0, 8).map(buildRow);
    results.append(...firstRows);

    if (outcomes.length > 8) {
      const overflow = el('details');
      overflow.className = 'results-overflow';
      const summary = el('summary');
      setText(summary, `Show ${outcomes.length - 8} more…`);
      overflow.append(summary);

      for (const doc of outcomes.slice(8)) overflow.append(buildRow(doc));
      results.append(overflow);
    }

    if (state.successIds.length > 0) downloadZipButton.disabled = false;
    setText(note, `${state.successIds.length} converted, ${outcomes.length - state.successIds.length} failed.`);
  }

  async function convertSelected(): Promise<SetDocumentOutcome[]> {
    const runToken = ++activeRunToken;
    const isCurrentRun = (): boolean => activeRunToken === runToken;

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
        workerFactory: appOptions.workerFactory,
        onProgress: (p) => {
          if (!isCurrentRun()) return;
          progress.value = p.processed;
          setText(progressStatus, `Converting ${p.processed} / ${p.total}…`);
        },
      });
      if (isCurrentRun()) {
        renderResults(outcomes);
        setText(
          progressStatus,
          `Done. ${state.successIds.length} converted, ${selected.length - state.successIds.length} failed.`,
        );
      }
      return outcomes;
    } finally {
      if (isCurrentRun()) {
        state.converting = false;
        // Allow re-running the same selection, or a new one, afterwards.
        convertButton.disabled = state.selectedIds.size === 0;
      }
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
  // Upload handling
  // -------------------------------------------------------------------------
  async function handleFile(file: File): Promise<void> {
    const generation = ++exportGeneration;
    activeRunToken += 1;
    resetOutputState(state);
    state.entries = [];
    state.skipped = [];
    searchInput.value = '';
    entryList.replaceChildren();
    entryList.hidden = true;
    results.replaceChildren();
    downloadZipButton.disabled = true;
    setText(preview, '');
    setText(note, '');
    progress.hidden = true;
    progressStatus.hidden = true;
    progress.value = 0;
    setText(progressStatus, '');
    convertButton.disabled = true;
    message.className = '';
    setText(message, '');

    if (file.size > MAX_FILE_BYTES) {
      message.className = 'error';
      setText(message, `This export is too large. The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
      return;
    }

    const text = await file.text();
    if (generation !== exportGeneration) return;

    const outcome = await parseExportText(text);
    if (generation !== exportGeneration) return;

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
    setText(progressStatus, '');

    const warningSummary = outcome.warnings.length === 0
      ? ''
      : ` ${outcome.warnings.length} import ${outcome.warnings.length === 1 ? 'warning' : 'warnings'} during import.`;
    setText(note, `${state.entries.length} posts or pages parsed.${warningSummary}`);
    convertButton.disabled = true;
    renderEntries();
  }

  // -------------------------------------------------------------------------
  // Wire up
  // -------------------------------------------------------------------------
  buildIntro();
  buildUploadForm();
  buildSelectStep();
  buildResultsStep();
  note.setAttribute('aria-live', 'polite');
  progressStatus.setAttribute('aria-live', 'polite');
  message.setAttribute('role', 'status');
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
      // Only rows outside the closed overflow <details> are part of the selection surface.
      return [...entryList.querySelectorAll<HTMLLabelElement>('.entry-list > .entry-row')].map((row) => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        const title = row.querySelector('strong');
        return {
          id: checkbox?.getAttribute('value') ?? '',
          title: title?.textContent ?? '',
          type: row.dataset.entryType ?? '',
          status: row.dataset.entryStatus ?? '',
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
    theme: {
      set(theme: 'light' | 'dark'): void {
        const toggle = document.querySelector<HTMLButtonElement>('.theme-toggle');
        themePreference = theme;
        document.documentElement.setAttribute('data-theme', theme);
        if (toggle) setText(toggle, `Theme: ${theme}`);
      },
      current(): 'light' | 'dark' {
        return themePreference;
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
