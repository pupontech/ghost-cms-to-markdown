export type DownloadTrigger = (blob: Blob, filename: string) => void;

const BLOB_REQUIRED = typeof Blob === 'function';

/** Forbids filenames that could escape the download directory. */
function isSafeFilename(filename: string): boolean {
  return !/[\\/]/.test(filename) && filename !== '..' && filename !== '.';
}

function defaultTrigger(blob: Blob, filename: string): void {
  // Environments without object URLs (e.g. jsdom) cannot download; stay a no-op.
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke even if click() throws, so the object URL never leaks.
    URL.revokeObjectURL(url);
  }
}

/**
 * Performs a browser download of `blob` under `filename`. Accepts an injected
 * trigger for testing; without one it uses a non-navigating anchor click.
 * Refuses invalid or path-typed filenames and missing blobs.
 */
export function downloadBlob(
  blob: Blob | null,
  filename: string,
  trigger: DownloadTrigger = defaultTrigger,
): void {
  if (!BLOB_REQUIRED || blob === null) return;
  if (!isSafeFilename(filename)) return;
  trigger(blob, filename);
}