/**
 * Port: business-card OCR/vision (P4-5). Local dev uses a stub; prod uses a
 * vision model (Claude via Bedrock). Fields it can't read stay null — never
 * guessed — and a non-card image is reported as such.
 */
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

export interface CardScanner {
  scan(image: Uint8Array): Promise<CardScanResult>;
}
