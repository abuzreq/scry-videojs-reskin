/**
 * A critically damped spring: it glides to its target and never overshoots. The picture in the orb follows the
 * pointer through one of these, so coarse pointer moves still read as smooth travel.
 *
 * Each step is the spring's exact motion over that stretch of time, not an approximation built from small steps.
 * That matters on slow devices: stepping it numerically goes unstable once a frame takes longer than about
 * 0.8 / stiffness seconds, and the picture flies off instead of arriving.
 */
export class Spring {
  value = 0;
  velocity = 0;

  /** Jump straight to `value` and stop. */
  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }

  /** Move toward `target` for `dt` seconds. Higher `stiffness` arrives sooner; 13 settles in about a third of a second. */
  step(target: number, stiffness: number, dt: number): void {
    const offset = this.value - target;
    const drift = this.velocity + stiffness * offset;
    const decay = Math.exp(-stiffness * dt);

    this.value = target + (offset + drift * dt) * decay;
    this.velocity = (this.velocity - drift * stiffness * dt) * decay;
  }
}

/** Ease `value` toward `goal` at `rate` per second, independent of frame rate. */
export function toward(value: number, goal: number, rate: number, dt: number): number {
  return value + (goal - value) * (1 - Math.exp(-dt * rate));
}

/** Smoothstep on 0..1, clamped. */
export function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, value));

  return t * t * (3 - 2 * t);
}
