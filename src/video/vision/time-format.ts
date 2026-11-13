/** Times as the skin writes them. */

/** "1:24", or "1:02:03" past the hour. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');

  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${rest}`;
}

/** "+1:24" or "−0:30"; empty for less than a second. */
export function formatOffset(seconds: number): string {
  if (Math.abs(seconds) < 1) return '';

  return `${seconds > 0 ? '+' : '−'}${formatTime(Math.round(Math.abs(seconds)))}`;
}
