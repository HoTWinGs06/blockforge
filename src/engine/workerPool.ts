/**
 * BlockForge — chunk worker orchestration.
 *
 * OWNERSHIP: ENGINE.
 *
 * Chunk generation is the expensive part of loading a world, so it runs in
 * workers. The pool is deliberately thin: a message in, a message out, no
 * shared state, no ordering assumptions. The result of a request depends only
 * on the seed and the chunk key, so a worker returning chunks in any order
 * changes nothing about the world.
 *
 * The worker factory is injectable, so the pool can run against real Web
 * Workers in a browser and against a plain function in Node (tests, the
 * benchmark, the determinism script).
 */

import type { Chunk, ChunkKey } from "../core/types.js";
import { chunkKeyToString } from "../core/constants.js";
import { generateChunk } from "../core/world.js";

/** A request for one chunk. */
export interface ChunkRequest {
  readonly seed: number;
  readonly cx: number;
  readonly cz: number;
}

/** A response carrying one generated chunk. */
export interface ChunkResponse {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
}

/** The minimum a worker must do to serve the pool. */
export interface ChunkWorker {
  postMessage(request: ChunkRequest): void;
  terminate(): void;
  onmessage: ((event: { data: ChunkResponse }) => void) | null;
}

/** Creates a worker. */
export type WorkerFactory = () => ChunkWorker;

/**
 * A pool of workers that generate chunks.
 *
 * Requests are dispatched to whichever worker is free; responses are
 * returned to the caller through the promise. The pool never reorders
 * results — the caller gets exactly the chunk it asked for.
 */
export class ChunkWorkerPool {
  private readonly workers: ChunkWorker[] = [];
  private readonly idle: ChunkWorker[] = [];
  private readonly pending = new Map<
    ChunkWorker,
    (response: ChunkResponse) => void
  >();
  private readonly factory: WorkerFactory;
  private disposed = false;

  constructor(factory: WorkerFactory, size = 1) {
    this.factory = factory;
    for (let i = 0; i < size; i++) {
      this.spawn();
    }
  }

  private spawn(): ChunkWorker {
    const worker = this.factory();
    worker.onmessage = (event): void => {
      const resolve = this.pending.get(worker);
      this.pending.delete(worker);
      this.idle.push(worker);
      resolve?.(event.data);
    };
    this.workers.push(worker);
    this.idle.push(worker);
    return worker;
  }

  /** The number of workers in the pool. */
  get size(): number {
    return this.workers.length;
  }

  /** Generate a chunk on a worker. */
  generate(seed: number, key: ChunkKey): Promise<Chunk> {
    if (this.disposed) {
      return Promise.reject(new Error("ChunkWorkerPool is disposed"));
    }
    const worker = this.idle.pop() ?? this.spawn();
    return new Promise<Chunk>((resolve) => {
      this.pending.set(worker, (response) => {
        resolve({
          key: { cx: response.cx, cz: response.cz },
          blocks: response.blocks,
        });
      });
      worker.postMessage({ seed, cx: key.cx, cz: key.cz });
    });
  }

  /** Shut the pool down. */
  dispose(): void {
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
    this.idle.length = 0;
    this.pending.clear();
  }
}

/**
 * A worker factory that runs the generation inline.
 *
 * Used in Node — in tests, in the benchmark and in the determinism script —
 * where Web Workers do not exist. The result is identical to the worker
 * path, because generation is a pure function of the seed and the key.
 */
export function inlineWorkerFactory(): ChunkWorker {
  const worker: ChunkWorker = {
    onmessage: null,
    postMessage(request) {
      const chunk = generateChunk(request.seed, { cx: request.cx, cz: request.cz });
      const response: ChunkResponse = {
        cx: request.cx,
        cz: request.cz,
        blocks: chunk.blocks,
      };
      // The pool reads the response from `onmessage`, so deliver it there.
      // A resolved promise is the portable way to defer a task to the
      // microtask queue without depending on a browser or Node global.
      void Promise.resolve().then(() => {
        worker.onmessage?.({ data: response });
      });
    },
    terminate() {
      worker.onmessage = null;
    },
  };
  return worker;
}

/** A stable key for a chunk, for logs and for the board. */
export function chunkLabel(key: ChunkKey): string {
  return chunkKeyToString(key);
}
