import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PointersCard, type Pointer } from './PointersCard.js';
import { humanizeIsoDates } from '../format/dates.js';

/** [P21-D] An ISO date inside pointer TEXT ("(for 2026-04-06)") is formatted like every other date;
 *  only ISO shapes are touched — a date the client wrote another way stays exactly as written. */
const P = (text: string): Pointer => ({ section: 'relationship', text, receipts: [] });

describe('[P21-D] pointer text dates', () => {
  it('formats an ISO date or timestamp in the pointer text', () => {
    const { container } = render(<PointersCard clientName="Layla" pointers={[P('Confirm the viewing (for 2026-04-06)'), P('She asked at 2026-04-02T13:02:00 about parking')]} disclosure={null} />);
    expect(container.textContent).toContain('Confirm the viewing (for 6 Apr 2026)');
    expect(container.textContent).toContain('She asked at 2 Apr 2026, 13:02 about parking');
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('NEGATIVE: non-ISO dates, amounts and references are left exactly as written', () => {
    expect(humanizeIsoDates('budget 2.2M, ref 12345-67, on 20/03/2026')).toBe('budget 2.2M, ref 12345-67, on 20/03/2026');
    expect(humanizeIsoDates('2026-13-45')).toBe('2026-13-45');
  });
});
