// Development only: contact sheets of the liquid engine, for judging the morph by eye. Not part of the build.
//   lab.html?pairs=2,10,22&mode=flat      rows of the bare morph across each pair
//   lab.html?pairs=2,10,22&mode=orb       the same inside the orb
//   lab.html?mode=bloom&pairs=10          the orb opening over a frame
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

  if (mode === 'flat') {
    const w = cell;
    const h = Math.round(cell / aspect);

    canvas.width = w * steps;
    canvas.height = h * pairs.length;
    pairs.forEach((pair, row) => {
      for (let i = 0; i < steps; i++) engine.renderFlat(timeAt(pair, i / (steps - 1)), i * w, row * h, w, h);
    });
  } else {
    // The orb clears the canvas on each draw, so cells are copied out to a 2D sheet.
    const sheet = document.createElement('canvas');
    const bloom = mode === 'bloom';
    const w = bloom ? Math.round(cell * aspect) : cell;
    const h = cell;

    sheet.width = w * steps;
    sheet.height = h * pairs.length;
    canvas.width = w;
    canvas.height = h;

    const context = sheet.getContext('2d')!;

    context.fillStyle = '#6d7480';
    context.fillRect(0, 0, sheet.width, sheet.height);
    pairs.forEach((pair, row) => {
      for (let i = 0; i < steps; i++) {
        const f = i / (steps - 1);

        engine.render({
          time: bloom ? timeAt(pair, 0) : timeAt(pair, f),
          x: bloom ? w * 0.62 : w / 2,
          y: bloom ? h * 0.7 : h / 2,
          radius: bloom ? h * 0.2 : h * 0.42,
          frame: { x: 0, y: 0, width: w, height: h },
          presence: 1,
          bloom: bloom ? f : 0,
          reveal: 0,
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
