import {
  serializeFrontMatter,
  type FrontMatterKey,
  type FrontMatterMetadata,
} from './frontmatter';
import { allocateFilenames } from './filename';
import { convertEntryHtml, type EntryConversion } from './convert-entry';
import { createWorkerHost, type WorkerHost, type WorkerLike } from './worker-host';
import type { WorkerConvertItem, WorkerConvertResult } from './worker-protocol';
import type { NormalizedEntry } from './parser';

export interface DocumentOptions {
  frontMatter?: boolean;
  fields?: readonly FrontMatterKey[];
}

export interface DocumentError {
  code: string;
  message: string;
}

export type DocumentOutcome =
  | { ok: true; filename: string; markdown: string; warnings: string[] }
  | { ok: false; error: DocumentError };

/**
 * One per-entry result from a set-level build. Mirrors {@link DocumentOutcome}
 * but carries the source entry id so callers can pair outcomes back to rows.
 */
export type SetDocumentOutcome =
  | { ok: true; entryId: string; filename: string; markdown: string; warnings: string[] }
  | { ok: false; entryId: string; error: DocumentError };

function toMetadata(entry: NormalizedEntry): FrontMatterMetadata {
  return {
    title: entry.title || null,
    slug: entry.slug || null,
    date: entry.publishedAt,
    updated: entry.updatedAt,
    author: entry.authors.length
      ? entry.authors.length === 1
        ? entry.authors[0]
        : entry.authors
      : null,
    tags: entry.tags.length ? entry.tags : null,
    canonicalUrl: entry.canonicalUrl,
  };
}

interface ConvertibleOutput {
  markdown: string;
  warnings: string[];
}

/**
 * Normalizes and converts a single entry to Markdown. Returns the converted
 * body, or a per-entry error when the entry has no usable content or sanitizes
 * to nothing. One entry at a time so sync and async batch builds share it.
 *
 * This is a pure, DOM-free operation; the same logic runs inside the worker.
 */
function convertOne(entry: NormalizedEntry): { convertible?: ConvertibleOutput; error?: DocumentError } {
  const conversion = convertEntryHtml(entry.html);
  if (!conversion.ok) {
    return { error: { code: conversion.code, message: conversion.message } };
  }
  return { convertible: { markdown: conversion.markdown, warnings: conversion.warnings } };
}

/** Maps a worker result (keyed by entryId) onto the batch's outcome maps. */
function applyWorkerResults(
  batch: readonly NormalizedEntry[],
  results: readonly WorkerConvertResult[],
  convertible: Map<string, ConvertibleOutput>,
  failures: Map<string, DocumentError>,
): void {
  for (const item of batch) {
    const result = results.find((r) => r.entryId === item.id);
    if (!result) {
      failures.set(item.id, { code: 'worker-missed-entry', message: 'Entry was not converted.' });
      continue;
    }
    applyConversion(item.id, result.conversion, convertible, failures);
  }
}

function applyConversion(
  id: string,
  conversion: EntryConversion,
  convertible: Map<string, ConvertibleOutput>,
  failures: Map<string, DocumentError>,
): void {
  if (conversion.ok) {
    convertible.set(id, { markdown: conversion.markdown, warnings: conversion.warnings });
  } else {
    failures.set(id, { code: conversion.code, message: conversion.message });
  }
}

/**
 * Rebuilds per-entry {@link SetDocumentOutcome}s in input order from the shared
 * conversion maps and a single filename allocation.
 */
function assembleResults(
  entries: readonly NormalizedEntry[],
  convertible: Map<string, ConvertibleOutput>,
  failures: Map<string, DocumentError>,
  filenames: Map<string, string>,
  options: DocumentOptions,
): SetDocumentOutcome[] {
  const results: SetDocumentOutcome[] = [];

  for (const entry of entries) {
    const converted = convertible.get(entry.id);
    if (converted === undefined) {
      results.push({
        ok: false,
        entryId: entry.id,
        error: failures.get(entry.id) ?? { code: 'no-content', message: 'Entry cannot be converted.' },
      });
      continue;
    }

    const frontMatter =
      options.frontMatter === false ? '' : serializeFrontMatter(toMetadata(entry), options.fields);

    const filename = filenames.get(entry.id) as string;
    results.push({
      ok: true,
      entryId: entry.id,
      filename,
      markdown: frontMatter + converted.markdown,
      warnings: converted.warnings,
    });
  }

  return results;
}

/**
 * Builds Markdown documents for a whole set of entries in one pass. A single
 * filename allocation runs across the successfully-converted entries, so
 * duplicate slugs receive unique, deterministic names (never clobbering each
 * other) and a failed entry does not consume a filename slot.
 *
 * Entries that sanitize to no safe Markdown (or have no content) are reported
 * as failures rather than front-matter-only documents. Returns one outcome per
 * input entry, in input order. For large sets prefer
 * {@link buildDocumentsAsync} so the browser stays responsive.
 */
export function buildDocuments(
  entries: readonly NormalizedEntry[],
  options: DocumentOptions = {},
): SetDocumentOutcome[] {
  const convertible = new Map<string, ConvertibleOutput>();
  const failures = new Map<string, DocumentError>();

  for (const entry of entries) {
    const result = convertOne(entry);
    if (result.convertible) convertible.set(entry.id, result.convertible);
    else failures.set(entry.id, result.error as DocumentError);
  }

  // One global allocation over the outputs that will actually exist, so
  // duplicate slugs stay unique and gaps are never left for failed entries.
  const filenames = allocateFilenames(
    entries
      .filter((entry) => convertible.has(entry.id))
      .map((entry) => ({ id: entry.id, slug: entry.slug, title: entry.title })),
  );

  return assembleResults(entries, convertible, failures, filenames, options);
}

/**
 * Builds one Markdown document for a single normalized entry: normalizes the
 * content, sanitizes and converts it to Markdown, prepends optional YAML front
 * matter, and derives a deterministic safe filename. This is a thin convenience
 * over {@link buildDocuments} for callers converting a single entry.
 */
export function buildDocument(
  entry: NormalizedEntry,
  options: DocumentOptions = {},
): DocumentOutcome {
  const next = buildDocuments([entry], options)[0];

  if (next.ok) {
    return { ok: true, filename: next.filename, markdown: next.markdown, warnings: next.warnings };
  }
  return { ok: false, error: next.error };
}

/** Snapshot of asynchronous batch-build progress, reported after each batch. */
export interface AsyncProgress {
  /** Entries processed so far (monotonic, ends at `total`). */
  processed: number;
  /** Total entries in the batch. */
  total: number;
  /** Entries that produced a successful Markdown document so far. */
  succeeded: number;
  /** Entries that failed so far. */
  failed: number;
}

export interface AsyncBuildOptions extends DocumentOptions {
  /** Entries processed before yielding to the browser. Defaults to 25. */
  chunkSize?: number;
  /** Invoked after each bounded batch so callers can render progress. */
  onProgress?: (progress: AsyncProgress) => void;
  /**
   * Test seam: inject a factory that mints the conversion worker. When omitted
   * a real browser Web Worker is used when available, otherwise conversion
   * falls back to the main thread.
   */
  workerFactory?: () => WorkerLike;
}

const DEFAULT_CHUNK_SIZE = 25;

/**
 * Builds Markdown documents for a whole set of entries asynchronously. The
 * expensive per-entry sanitize/convert work runs inside a typed Web Worker so
 * even a 10k-scale export never blocks the main thread. Conversion results
 * mirror {@link buildDocuments} exactly: one global, collision-safe filename
 * allocation runs across the successfully-converted entries, results come back
 * one per input entry in input order, and a failed entry is reported per-entry
 * without stopping the run.
 *
 * If the worker is unavailable (or fails to start, errors, or times out), the
 * conversion gracefully falls back to bounded batches on the main thread while
 * preserving the same progress/error/result ordering.
 */
export async function buildDocumentsAsync(
  entries: readonly NormalizedEntry[],
  options: AsyncBuildOptions = {},
): Promise<SetDocumentOutcome[]> {
  const total = entries.length;
  const chunkSize = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : DEFAULT_CHUNK_SIZE;

  const convertible = new Map<string, ConvertibleOutput>();
  const failures = new Map<string, DocumentError>();

  let processed = 0;
  const onProgress = options.onProgress;

  const report = (): void => {
    onProgress?.({ processed, total, succeeded: convertible.size, failed: failures.size });
  };

  const host = buildHost(options);

  try {
    if (total === 0) {
      report();
      return [];
    }

    for (let start = 0; start < total; start += chunkSize) {
      const batch = entries.slice(start, start + chunkSize);
      const converted = await convertBatch(batch, host, convertible, failures);
      processed += converted;
      report();
    }
  } finally {
    host?.dispose();
  }

  // One global allocation over the outputs that will actually exist, so
  // duplicate slugs stay unique and gaps are never left for failed entries.
  const filenames = allocateFilenames(
    entries
      .filter((entry) => convertible.has(entry.id))
      .map((entry) => ({ id: entry.id, slug: entry.slug, title: entry.title })),
  );

  return assembleResults(entries, convertible, failures, filenames, options);
}

function buildHost(options: AsyncBuildOptions): WorkerHost | null {
  if (typeof options.workerFactory === 'function') return createWorkerHost(options.workerFactory);
  if (typeof Worker === 'undefined') return null;
  return createWorkerHost();
}

/**
 * Converts one batch of entries, preferring the worker and falling back to the
 * main thread when the worker is unavailable or fails. Returns the number of
 * entries processed.
 */
async function convertBatch(
  batch: readonly NormalizedEntry[],
  host: WorkerHost | null,
  convertible: Map<string, ConvertibleOutput>,
  failures: Map<string, DocumentError>,
): Promise<number> {
  if (host !== null && host.supported) {
    const items: WorkerConvertItem[] = batch.map((entry) => ({
      entryId: entry.id,
      html: entry.html,
    }));
    try {
      const results = await host.convert(items);
      if (results !== null) {
        applyWorkerResults(batch, results, convertible, failures);
        return batch.length;
      }
    } catch {
      // Fall through to the main thread for this batch.
    }
  }

  for (const entry of batch) {
    const result = convertOne(entry);
    if (result.convertible) convertible.set(entry.id, result.convertible);
    else failures.set(entry.id, result.error as DocumentError);
  }
  return batch.length;
}