/** Client for business-card scanning (P4-5). */

export interface ScannedContact {
  name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
}

export interface CardScanResult {
  isCard: boolean;
  contact: ScannedContact | null;
}

export class CardsClient {
  constructor(private readonly baseUrl: string = '') {}

  async scan(image: Blob): Promise<CardScanResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/cards/scan`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': image.type || 'application/octet-stream' },
        body: image,
      });
      if (res.status !== 200) return null;
      return (await res.json()) as CardScanResult;
    } catch {
      return null;
    }
  }
}
