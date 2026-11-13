// Development only: contact sheets of the liquid engine, for judging the morph by eye. Not part of the build.
//   lab.html?pairs=2,10,22&mode=flat      rows of the bare morph across each pair
//   lab.html?pairs=2,10,22&mode=orb       the same inside the orb
//   lab.html?mode=wrap&pairs=10           the frame wrapping into the big orb (also mode=mist, mode=small-mist)
import { LiquidEngine } from '@/liquid/engine';
import { loadSprite, tilesFromCues } from '@/liquid/storyboard';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '83EzHOvVzVN01AsrD01BCpiH02Pj3S8mfzBOu101w2nHC5s';
const mode = params.get('mode') ?? 'flat';
const pairs = (params.get('pairs') ?? '0,2,10,17,22').split(',').map(Number);
const steps = Number(params.get('steps') ?? 7);
const cell = Number(params.get('cell') ?? 220);
const log = (text: string) => {
  document.getElementById('log')!.textContent += `${text}\n`;
  console.log(`[scry] ${text}`);
};

async function main() {
  const vttUrl = `https://image.mux.com/${id}/storyboard.vtt`;
  const vtt = await (await fetch(vttUrl)).text();
  const cues = [...vtt.matchAll(/(\d+):(\d+):([\d.]+) --> .*\n(.+)/g)].map((m) => ({
    startTime: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
    text: m[4]!,
  }));
  const board = tilesFromCues(cues, vttUrl)!;
  const image = await loadSprite(board.url, 'anonymous');
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const engine = new LiquidEngine(canvas);
  const t0 = performance.now();

  engine.setStoryboard(image, board.tiles);
  const t1 = performance.now();

  while (engine.pending > 0) engine.solve(8);
  const t2 = performance.now();

  log(`tiles ${board.tiles.length} (${board.tiles[0]!.width}x${board.tiles[0]!.height}), upload ${(t1 - t0).toFixed(0)}ms, flow ${(t2 - t1).toFixed(0)}ms`);

  const tiles = engine.tiles;
  const aspect = tiles[0]!.width / tiles[0]!.height;
  const timeAt = (pair: number, f: number) => tiles[pair]!.time + (tiles[pair + 1]!.time - tiles[pair]!.time) * f;

  if (mode === 'depth') {
    // Tiles on the top row, the model's depth for each underneath (white is near).
    const { DepthEstimator, depthInputSize } = await import('@/liquid/depth');
    const estimator = new DepthEstimator((params.get('device') as 'webgpu' | 'wasm') ?? 'wasm');
    const t3 = performance.now();

    await estimator.ready;
    log(`model ready in ${((performance.now() - t3) / 1000).toFixed(1)}s`);

    const size = depthInputSize(tiles[0]!.width, tiles[0]!.height);
    const sheet = document.createElement('canvas');
    const w = cell;
    const h = Math.round(cell / aspect);

    sheet.width = w * pairs.length;
    sheet.height = h * 2;

    const context = sheet.getContext('2d')!;
    const times: number[] = [];

    for (const [column, index] of pairs.entries()) {
      const tile = tiles[index]!;
      const t4 = performance.now();
      const bitmap = await createImageBitmap(image, tile.x, tile.y, tile.width, tile.height, {
        resizeWidth: size.width,
        resizeHeight: size.height,
      });
      const map = await estimator.estimate(bitmap);

      times.push(performance.now() - t4);
      context.drawImage(image, tile.x, tile.y, tile.width, tile.height, column * w, 0, w, h);

      const picture = new ImageData(map.width, map.height);

      map.data.forEach((value, i) => picture.data.set([value, value, value, 255], i * 4));

      const scratch = document.createElement('canvas');

      scratch.width = map.width;
      scratch.height = map.height;
      scratch.getContext('2d')!.putImageData(picture, 0, 0);
      context.drawImage(scratch, column * w, h, w, h);
    }

    log(`input ${size.width}x${size.height}, per tile ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
    estimator.dispose();
    canvas.replaceWith(sheet);
  } else if (mode === 'flat') {
    const w = cell;
    const h = Math.round(cell / aspect);

    canvas.width = w * steps;
    canvas.height = h * pairs.length;
    pairs.forEach((pair, row) => {
      for (let i = 0; i < steps; i++) engine.renderFlat(timeAt(pair, i / (steps - 1)), i * w, row * h, w, h);
    });
  } else {
    // The orb clears the canvas on each draw, so cells are copied out to a 2D sheet.
    //   orb   the small orb across each pair          wrap  the frame wrapping into the big orb
    //   mist  the big orb filling with fog            small-mist  the waiting orb over a frame
    const sheet = document.createElement('canvas');
    const framed = mode !== 'orb';
    const ratio = Number(params.get('ratio') ?? aspect);
    const w = framed ? Math.round(cell * ratio) : cell;
    const h = cell;

    sheet.width = w * steps;
    sheet.height = h * pairs.length;
    canvas.width = w;
    canvas.height = h;

    const context = sheet.getContext('2d')!;
    // The picture's place in the cell, letterboxed like the player would.
    const fit = ratio > aspect ? { width: h * aspect, height: h } : { width: w, height: w / aspect };
    const frame = { x: (w - fit.width) / 2, y: (h - fit.height) / 2, ...fit };
    const big = Math.min(h * 0.4, w * 0.3);

    pairs.forEach((pair, row) => {
      for (let i = 0; i < steps; i++) {
        const f = i / (steps - 1);
        const small = mode === 'orb' || mode === 'small-mist';

        // Stand-in for the video underneath: the tile itself, flat.
        context.fillStyle = '#000';
        context.fillRect(i * w, row * h, w, h);

        if (framed) {
          const tile = tiles[pair]!;

          context.drawImage(image, tile.x, tile.y, tile.width, tile.height, i * w + frame.x, row * h + frame.y, frame.width, frame.height);
        } else {
          context.fillStyle = '#6d7480';
          context.fillRect(i * w, row * h, w, h);
        }

        engine.render({
          time: mode === 'orb' ? timeAt(pair, f) : timeAt(pair, mode === 'wrap' ? f * 0.5 : 0),
          x: w / 2,
          y: mode === 'orb' ? h / 2 : h * 0.46,
          radius: mode === 'orb' ? h * 0.42 : mode === 'small-mist' ? h * 0.13 : big,
          frame,
          presence: 1,
          wrap: mode === 'wrap' ? f : 1,
          stage: mode === 'wrap' ? Math.min(1, f * 1.4) : small ? 0 : 1,
          wide: small ? 0 : 1,
          mist: mode === 'mist' || mode === 'small-mist' ? f : 0,
          sparks: 0,
          clock: 3 + f * 6,
          reveal: 0,
          inspect: 0,
          stone: Number(params.get('stone') ?? 1),
          heat: mode === 'wrap' ? 0.6 : 0.2,
          detail: 0,
          parallax: [0, 0],
          dolly: 0,
          smear: 0,
          tilt: [0, 0],
          pixelRatio: 1,
        });
        context.drawImage(canvas, i * w, row * h);
      }
    });
    canvas.replaceWith(sheet);
  }

  document.title = 'lab ready';
}

main().catch((error) => log(`ERROR ${error?.stack ?? error}`));
