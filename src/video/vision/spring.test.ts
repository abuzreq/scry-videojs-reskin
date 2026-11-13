import { describe, expect, it } from 'vitest';
import { Spring, smooth, toward } from './spring';

describe('Spring', () => {
  it('arrives without overshooting', () => {
    const spring = new Spring();
    let peak = 0;

    for (let i = 0; i < 120; i++) {
      spring.step(10, 13, 1 / 60);
      peak = Math.max(peak, spring.value);
    }

    expect(spring.value).toBeCloseTo(10, 1);
    expect(peak).toBeLessThanOrEqual(10.001);
  });

  it('a stiffer spring gets there sooner', () => {
    const soft = new Spring();
    const stiff = new Spring();

    for (let i = 0; i < 12; i++) {
      soft.step(1, 13, 1 / 60);
      stiff.step(1, 22, 1 / 60);
    }

    expect(stiff.value).toBeGreaterThan(soft.value);
  });

  it.each([
    ['a smooth 60 frames a second', 1 / 60],
    ['a struggling 20', 1 / 20],
    ['a single frame that took a quarter of a second', 0.25],
  ])('stays stable and on the near side of its target at %s', (_, dt) => {
    const spring = new Spring();

    for (let t = 0; t < 2; t += dt) {
      spring.step(10, 22, dt);

      expect(spring.value).toBeGreaterThanOrEqual(0);
      expect(spring.value).toBeLessThanOrEqual(10.000001);
    }

    expect(spring.value).toBeCloseTo(10, 3);
  });

  it('ends in the same place however the time is sliced', () => {
    const coarse = new Spring();
    const fine = new Spring();

    coarse.step(10, 13, 0.2);

    for (let i = 0; i < 20; i++) fine.step(10, 13, 0.01);

    expect(fine.value).toBeCloseTo(coarse.value, 9);
    expect(fine.velocity).toBeCloseTo(coarse.velocity, 9);
  });

  it('snap stops it dead', () => {
    const spring = new Spring();

    spring.step(5, 13, 1 / 60);
    spring.snap(3);

    expect(spring.value).toBe(3);
    expect(spring.velocity).toBe(0);
  });
});

describe('easing', () => {
  it('toward covers the same ground however the time is sliced', () => {
    const once = toward(0, 1, 6, 0.1);
    const twice = toward(toward(0, 1, 6, 0.05), 1, 6, 0.05);

    expect(twice).toBeCloseTo(once, 10);
  });

  it('smooth is clamped and symmetric', () => {
    expect(smooth(-1)).toBe(0);
    expect(smooth(2)).toBe(1);
    expect(smooth(0.5)).toBe(0.5);
  });
});
