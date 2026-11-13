import { describe, expect, it } from 'vitest';
import { stillTime } from './exact-frame';

describe('stillTime', () => {
  it('reads the moment from a thumbnail address', () => {
    expect(stillTime('https://image.example/abc/thumbnail.webp?time=69')).toBe(69);
    expect(stillTime('https://image.example/abc/thumbnail.webp?width=512&time=12.5')).toBe(12.5);
  });

  it('is null when the address does not say', () => {
    expect(stillTime('https://example.com/poster.jpg')).toBeNull();
    expect(stillTime('')).toBeNull();
  });
});
