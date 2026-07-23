import { describe, it, expect } from 'vitest';
import { manifest } from './manifest.js';

// [P0-5] Installability requires a valid manifest: identity, a standalone
// display, sized icons (incl. maskable), and theme colors.
describe('PWA manifest', () => {
  it('has an app name and short name', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
  });

  it('has a start_url and an app-like display mode', () => {
    expect(manifest.start_url).toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  });

  it('declares 192px and 512px icons (installability minimum)', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('includes a maskable icon', () => {
    expect(manifest.icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBe(true);
  });

  it('sets theme and background colors', () => {
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  // [P5-3] Android share target: WhatsApp "Export chat" can share the .txt in.
  it('declares a share target that accepts a text file', () => {
    expect(manifest.share_target.method).toBe('POST');
    const accept = manifest.share_target.params.files.flatMap((f) => f.accept);
    expect(accept).toContain('text/plain');
  });
});
