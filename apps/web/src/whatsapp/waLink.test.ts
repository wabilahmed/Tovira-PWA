import { describe, it, expect } from 'vitest';
import { whatsappLink } from './waLink.js';

describe('whatsappLink (P4-7)', () => {
  it('URL-encodes emojis, line breaks and Arabic text', () => {
    const url = whatsappLink('Hi 👋\nشكراً — talk soon');
    // The encoded text round-trips exactly (no corruption of emoji/newline/Arabic).
    const text = decodeURIComponent(url.split('text=')[1]!);
    expect(text).toBe('Hi 👋\nشكراً — talk soon');
    expect(url).toContain('%0A'); // newline is encoded, not dropped
  });

  it('targets a contact using digits only (strips +, spaces, dashes)', () => {
    expect(whatsappLink('hi', '+971 50-123 4567')).toBe('https://wa.me/971501234567?text=hi');
  });

  it('opens the contact picker when there is no phone', () => {
    expect(whatsappLink('hi')).toBe('https://wa.me/?text=hi');
    expect(whatsappLink('hi', '')).toBe('https://wa.me/?text=hi');
  });
});
