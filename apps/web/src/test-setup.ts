// Test setup for web component tests. jest-dom matchers just extend `expect`
// (safe everywhere); RTL cleanup only runs when a DOM is present, so this file is
// harmless when loaded for the node-environment API tests too.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
