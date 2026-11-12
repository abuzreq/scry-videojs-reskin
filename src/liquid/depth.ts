export type DepthDevice = 'webgpu' | 'wasm';

export interface DepthMap {
  width: number;
  height: number;
  /** One byte per pixel, row by row from the top: 0 far, 255 near. */
  data: Uint8Array;
}

type Reply =
  | { type: 'ready' }
  | ({ type: 'depth'; id: number } & DepthMap)
  | { type: 'error'; id: number; message: string };

/** The model works on a grid of 14-pixel patches. */
const PATCH = 14;

/** The input size nearest a tile's own size that the model accepts. Small on purpose: this is about speed. */
export function depthInputSize(tileWidth: number, tileHeight: number): { width: number; height: number } {
  const scale = Math.min(1, 308 / Math.max(tileWidth, tileHeight));

  return {
    width: Math.max(PATCH * 4, Math.round((tileWidth * scale) / PATCH) * PATCH),
    height: Math.max(PATCH * 4, Math.round((tileHeight * scale) / PATCH) * PATCH),
  };
}

/**
 * Monocular depth for storyboard tiles, from Depth Anything V2 Small running in a worker.
 *
 * This is the one part of the skin that downloads anything: the model (about 19 MB on WebGPU) and the ONNX runtime,
 * fetched once from the Hugging Face hub and jsDelivr and cached by the browser. It is optional by construction: the
 * engine draws the same orb without it, minus the parallax.
 */
export class DepthEstimator {
  readonly ready: Promise<void>;
  #worker: Worker;
  #pending = new Map<number, { resolve: (map: DepthMap) => void; reject: (error: Error) => void }>();
  #next = 0;

  constructor(device: DepthDevice) {
    this.#worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });

    this.ready = new Promise((resolve, reject) => {
      this.#worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data.type === 'ready') resolve();
        else if (data.type === 'depth') {
          this.#pending.get(data.id)?.resolve({ width: data.width, height: data.height, data: data.data });
          this.#pending.delete(data.id);
        } else {
          const error = new Error(data.message);

          if (data.id < 0) reject(error);
          this.#pending.get(data.id)?.reject(error);
          this.#pending.delete(data.id);
        }
      };
      this.#worker.onerror = (event) => reject(new Error(event.message || 'The depth worker failed to start'));
    });

    this.#worker.postMessage({ type: 'init', device });
  }

  /** Depth for one picture. The bitmap is handed to the worker and closed there. */
  estimate(bitmap: ImageBitmap): Promise<DepthMap> {
    const id = this.#next++;

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ type: 'run', id, bitmap }, [bitmap]);
    });
  }

  dispose(): void {
    this.#worker.terminate();

    for (const { reject } of this.#pending.values()) reject(new Error('Disposed'));

    this.#pending.clear();
  }
}
