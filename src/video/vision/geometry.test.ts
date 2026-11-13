import { describe, expect, it } from 'vitest';
import { bigShape, centreCircle, pictureRect, startShape } from './geometry';

describe('bigShape', () => {
  it.each([
    ['a desktop player', 1000, 562],
    ['a phone in portrait', 390, 219],
    ['a tall player', 400, 700],
    ['a very short one', 320, 150],
  ])('keeps the orb, and room for the curved bar under it, inside %s', (_, width, height) => {
    const orb = bigShape({ width, height });

    expect(orb.x).toBe(width / 2);
    expect(orb.radius).toBeGreaterThanOrEqual(36);

    if (height >= 200) {
      expect(orb.y - orb.radius).toBeGreaterThanOrEqual(0);
      expect(orb.y + orb.radius).toBeLessThanOrEqual(height - 58);
    }
  });
});

describe('pictureRect', () => {
  const host = { width: 1000, height: 1000 };

  it('letterboxes a wide picture under contain', () => {
    expect(pictureRect(host, 2, false, 1)).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
  });

  it('crops a wide picture under cover', () => {
    expect(pictureRect(host, 2, true, 1)).toEqual({ x: -500, y: 0, width: 2000, height: 1000 });
  });

  it('pillarboxes a tall picture under contain', () => {
    expect(pictureRect(host, 0.5, false, 1)).toEqual({ x: 250, y: 0, width: 500, height: 1000 });
  });

  it('answers in canvas pixels', () => {
    expect(pictureRect(host, 2, false, 2)).toEqual({ x: 0, y: 500, width: 2000, height: 1000 });
  });
});

describe('centreCircle', () => {
  it('sits higher on narrow players, where the skin lifts its centre button', () => {
    expect(centreCircle({ width: 400, height: 300 }).y).toBe(120);
    expect(centreCircle({ width: 1000, height: 600 }).y).toBe(300);
  });
});

describe('startShape', () => {
  it.each([
    ['a desktop player', 936, 526],
    ['a phone', 358, 201],
    ['a tall player', 400, 700],
  ])('centres the opening stone on the play control and keeps it clear of the controls on %s', (_, width, height) => {
    const centre = centreCircle({ width, height });
    const stone = startShape({ width, height }, centre);

    expect(stone.x).toBe(centre.x);
    expect(stone.y).toBe(centre.y);
    expect(stone.radius).toBeGreaterThan(centre.radius);
    expect(stone.y - stone.radius).toBeGreaterThanOrEqual(0);
    expect(stone.y + stone.radius).toBeLessThanOrEqual(height - 56);
  });
});
