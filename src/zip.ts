import JSZip from 'jszip';

export interface ZipDocument {
  entryId: string;
  type: 'post' | 'page';
  filename: string;
  markdown: string;
}

export interface ExportZipOptions {
  /** Top-level folder inside the ZIP. Defaults to `ghost-markdown-export`. */
  rootDir?: string;
  /** ZIP compression. Defaults to `STORE` (fast, no CPU cost in the browser). */
  compression?: 'STORE' | 'DEFLATE';
}

/** Rejects filenames that could escape their folder inside the ZIP. */
function isPathSafeFilename(filename: string): boolean {
  return !/[\\/]/.test(filename) && filename !== '.' && filename !== '..';
}

/**
 * Builds a browser-local ZIP of converted Markdown documents using JSZip.
 * Successful posts are placed at `ghost-markdown-export/posts/<filename>` and
 * pages at `ghost-markdown-export/pages/<filename>`. External asset URLs in the
 * Markdown are left unchanged (nothing is downloaded or rewritten by default).
 *
 * Documents whose filenames are not path-safe are skipped so a hostile
 * filename can never escape the export folder.
 */
export async function buildExportZip(
  documents: readonly ZipDocument[],
  options: ExportZipOptions = {},
): Promise<Blob> {
  const zip = new JSZip();
  const root = options.rootDir ?? 'ghost-markdown-export';
  const compression: 'STORE' | 'DEFLATE' = options.compression ?? 'STORE';

  for (const doc of documents) {
    if (!isPathSafeFilename(doc.filename)) continue;
    const folder = doc.type === 'page' ? 'pages' : 'posts';
    zip.file(`${root}/${folder}/${doc.filename}`, doc.markdown);
  }

  return zip.generateAsync({ type: 'blob', compression });
}