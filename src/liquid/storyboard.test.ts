import { describe, expect, it } from 'vitest';
import { tilesFromCues } from './storyboard';

const base = 'https://image.example/abc/storyboard.vtt';
const cue = (startTime: number, text: string) => ({ startTime, text });

describe('tilesFromCues', () => {
  it('reads sprite tiles, resolved against the track, in time order', () => {
    const board = tilesFromCues(
      [cue(10, 'storyboard.jpg#xywh=256,0,256,144'), cue(0, 'storyboard.jpg#xywh=0,0,256,144')],
      base
    );

    expect(board?.url).toBe('https://image.example/abc/storyboard.jpg');
    expect(board?.tiles).toEqual([
      { x: 0, y: 0, width: 256, height: 144, time: 0 },
      { x: 256, y: 0, width: 256, height: 144, time: 10 },
    ]);
  });

  it('keeps only the first sprite', () => {
    const board = tilesFromCues(
      [cue(0, 'a.jpg#xywh=0,0,10,10'), cue(1, 'a.jpg#xywh=10,0,10,10'), cue(2, 'b.jpg#xywh=0,0,10,10')],
      base
    );

    expect(board?.tiles).toHaveLength(2);
  });

  it('needs at least two tiles to be worth flowing between', () => {
    expect(tilesFromCues([cue(0, 'a.jpg#xywh=0,0,10,10')], base)).toBeNull();
    expect(tilesFromCues([cue(0, 'a plain thumbnail.jpg'), cue(1, 'another.jpg')], base)).toBeNull();
  });
});
