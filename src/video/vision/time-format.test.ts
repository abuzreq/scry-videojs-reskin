import { describe, expect, it } from 'vitest';
import { formatOffset, formatTime } from './time-format';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [84.9, '1:24'],
    [3723, '1:02:03'],
    [-5, '0:00'],
  ])('%s seconds reads %s', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });
});

describe('formatOffset', () => {
  it('signs the offset, with a true minus', () => {
    expect(formatOffset(84)).toBe('+1:24');
    expect(formatOffset(-30)).toBe('−0:30');
  });

  it('says nothing for less than a second', () => {
    expect(formatOffset(0.4)).toBe('');
  });
});
