import type {
  WorkerRequest,
  WorkerResponse,
  WorkerConvertItem,
  WorkerConvertResult,
} from './worker-protocol';
import type { ImportOutcome } from './parser';

/**
 * The slice of the Web Worker API that {@link WorkerHost} relies on, so tests
 * can inject a lightweight stand-in and we never depend on browser globals.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  terminate(): void;
}

/**
 * Owns a single conversion Web Worker over a typed request/response protocol.
 * Falls back gracefully: when a worker cannot be created or errors at any
 * point, {@link WorkerHost.convert} resolves `null` so callers can convert on
 * the main thread instead.
 */
export interface WorkerHost {
  readonly supported: boolean;
  parse(text: string): Promise<ImportOutcome | null>;
  convert(items: WorkerConvertItem[]): Promise<WorkerConvertResult[] | null>;
  dispose(): void;
}

/** How long to wait for a batch reply before giving up and falling back. */
const REQUEST_TIMEOUT_MS = 10_000;

type PendingRequest =
  | { kind: 'parse'; resolve: (outcome: ImportOutcome | null) => void }
  | { kind: 'convert'; resolve: (results: WorkerConvertResult[] | null) => void };

export function createWorkerHost(
  factory?: () => WorkerLike,
): WorkerHost {
  const useFactory = typeof factory === 'function';
  let worker: WorkerLike | null = null;
  let initPromise: Promise<void> | null = null;
  let failure: string | null = null;
  let requestIdGen = 0;
  let disposed = false;
  const pending = new Map<number, PendingRequest>();

  function isUnavailable(): boolean {
    if (disposed) return true;
    if (useFactory) return false;
    return typeof Worker === 'undefined';
  }

  function spawn(): WorkerLike | null {
    try {
      if (useFactory) return factory();
      const instance = new Worker(new URL('./conversion-worker.ts', import.meta.url), {
        type: 'module',
      });
      return instance as unknown as WorkerLike;
    } catch {
      return null;
    }
  }

  function markFailed(reason: string): void {
    if (failure !== null) return;
    failure = reason;
    const requests = [...pending.values()];
    pending.clear();
    for (const request of requests) request.resolve(null);
  }

  function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = new Promise((resolve) => {
      if (isUnavailable()) {
        failure = failure ?? 'web-worker-unavailable';
        resolve();
        return;
      }
      const spawned = spawn();
      if (!spawned) {
        failure = failure ?? 'web-worker-failed-to-start';
        resolve();
        return;
      }
      worker = spawned;
      worker.onmessage = (event) => {
        const message = event.data as WorkerResponse;
        if (message.kind === 'parseResult') {
          const request = pending.get(message.requestId);
          if (!request || request.kind !== 'parse') return;
          pending.delete(message.requestId);
          request.resolve(message.outcome);
          return;
        }
        if (message.kind !== 'batchResult') return;
        const request = pending.get(message.requestId);
        if (!request || request.kind !== 'convert') return;
        pending.delete(message.requestId);
        request.resolve(message.results);
      };
      worker.onerror = () => markFailed('web-worker-error');
      resolve();
    });
    return initPromise;
  }

  return {
    get supported(): boolean {
      return !isUnavailable();
    },

    async parse(text: string): Promise<ImportOutcome | null> {
      await init();
      if (failure !== null || worker === null) return null;

      const requestId = ++requestIdGen;
      return new Promise<ImportOutcome | null>((resolve) => {
        const timer = setTimeout(() => {
          if (pending.has(requestId)) {
            pending.delete(requestId);
            resolve(null);
          }
        }, REQUEST_TIMEOUT_MS);

        pending.set(requestId, {
          kind: 'parse',
          resolve: (outcome) => {
            clearTimeout(timer);
            resolve(outcome);
          },
        });

        try {
          const request: WorkerRequest = { kind: 'parseExport', requestId, text };
          worker!.postMessage(request);
        } catch {
          pending.delete(requestId);
          clearTimeout(timer);
          markFailed('web-worker-error');
          resolve(null);
        }
      });
    },

    async convert(items): Promise<WorkerConvertResult[] | null> {
      await init();
      if (failure !== null || worker === null) return null;

      const requestId = ++requestIdGen;
      return new Promise<WorkerConvertResult[] | null>((resolve) => {
        const timer = setTimeout(() => {
          if (pending.has(requestId)) {
            pending.delete(requestId);
            resolve(null);
          }
        }, REQUEST_TIMEOUT_MS);

        pending.set(requestId, {
          kind: 'convert',
          resolve: (results) => {
            clearTimeout(timer);
            resolve(results);
          },
        });

        try {
          const request: WorkerRequest = { kind: 'convertBatch', requestId, items };
          worker!.postMessage(request);
        } catch {
          pending.delete(requestId);
          clearTimeout(timer);
          markFailed('web-worker-error');
          resolve(null);
        }
      });
    },

    dispose(): void {
      disposed = true;
      worker?.terminate();
      worker = null;
      initPromise = null;
      const requests = [...pending.values()];
      pending.clear();
      for (const request of requests) request.resolve(null);
    },
  };
}