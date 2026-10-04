// Test setup for web component tests. jest-dom matchers just extend `expect`
// (safe everywhere); RTL cleanup only runs when a DOM is present, so this file is
// harmless when loaded for the node-environment API tests too.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

// jsdom's Blob/File does not implement arrayBuffer() (real browsers do). The bulk-import page reads
// picked files as bytes, so polyfill it via FileReader for the component tests.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(this as unknown as Blob);
    });
  };
}
