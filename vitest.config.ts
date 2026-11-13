import { defineConfig } from 'vitest/config';

// Unit tests cover the parts of the skin that need no browser: the wrap's state machine, the spring, layout
// arithmetic and parsing. What needs a real player is checked in the workbench (see README).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
