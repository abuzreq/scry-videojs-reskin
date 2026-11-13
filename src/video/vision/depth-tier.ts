import type { DepthDevice, DepthEstimator } from '../../liquid/depth';
import type { LiquidEngine, Tile } from '../../liquid/engine';

/**
 * Which backend the depth tier may use, or null when it stays off. `auto` uses WebGPU where there is one and the
 * viewer has not asked to save data; `wasm` forces the slow WebAssembly backend; anything else is off.
 */
export function depthDevice(mode: string | null, reducedMotion: boolean): DepthDevice | null {
  if (mode === 'wasm') return 'wasm';
  if (mode !== 'auto' || reducedMotion) return null;

  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;

  return 'gpu' in navigator && !saveData ? 'webgpu' : null;
}

/**
 * One background pass of the depth model over a storyboard: nearest the playhead first, each tile's depth handed
 * to the engine as it arrives. Any failure (no network, an unsupported GPU, a model that will not load) just leaves
 * the orb flat. The model is only loaded if a run starts, and is let go when the run ends.
 */
export class DepthTier {
  #estimator: DepthEstimator | null = null;
  #run = 0;

  async start(
    engine: LiquidEngine,
    image: HTMLImageElement,
    tiles: readonly Tile[],
    device: DepthDevice,
    nearest: () => number,
    progress: () => void
  ): Promise<void> {
    this.stop();

    const run = this.#run;

    if (tiles.length === 0) return;

    try {
      const { DepthEstimator, depthInputSize } = await import('../../liquid/depth');

      if (run !== this.#run) return;

      const estimator = new DepthEstimator(device);

      this.#estimator = estimator;
      await estimator.ready;

      const size = depthInputSize(tiles[0]!.width, tiles[0]!.height);
      const start = nearest();
      const order = tiles.map((_, index) => index).sort((a, b) => Math.abs(a - start) - Math.abs(b - start));

      for (const index of order) {
        if (run !== this.#run || !engine.alive) return;

        const tile = tiles[index]!;
        const bitmap = await createImageBitmap(image, tile.x, tile.y, tile.width, tile.height, {
          resizeWidth: size.width,
          resizeHeight: size.height,
          resizeQuality: 'medium',
        });
        const map = await estimator.estimate(bitmap);

        if (run !== this.#run) return;

        engine.setDepth(index, map.data, map.width, map.height);
        progress();
      }
    } catch {
      // Stay flat.
    } finally {
      if (run === this.#run) this.stop();
    }
  }

  stop(): void {
    this.#run++;
    this.#estimator?.dispose();
    this.#estimator = null;
  }
}
