import type { CardScanner, CardScanResult } from '../../ports/card-scanner.js';

/** Local stand-in for the vision model: returns a canned card scan. */
export class StubCardScanner implements CardScanner {
  constructor(private readonly result: CardScanResult = { isCard: true, contact: { name: 'Sample Contact', title: 'VP Sales', phone: null, email: 'sample@example.com' } }) {}
  async scan(): Promise<CardScanResult> {
    return this.result;
  }
}
