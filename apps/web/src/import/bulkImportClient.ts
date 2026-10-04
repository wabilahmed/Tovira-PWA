/**
 * [BULK-IMPORT page] Client for the multi-file import endpoints. Files are uploaded ONE per request
 * (the API caps a JSON body at 1 MB; 20 exports are far more), then parsed and imported by batch id.
 */
import type { ReviewResult, Upsell } from './ImportReview.js';
import type { BulkJob } from './BulkImportResult.js';

export interface BulkParseResponse {
  result: ReviewResult;
  percentOfAllowance: number;
  upsell?: Upsell;
}
export interface BulkStatusResponse {
  jobs: BulkJob[];
  done: boolean;
  upsell?: Upsell;
}

export interface BulkImportApi {
  /** Upload one file's RAW bytes into the pending batch. `tooLarge` when the server refused it for size. */
  uploadFile(batchId: string, index: number, name: string, bytes: Uint8Array): Promise<{ ok: boolean; tooLarge?: boolean }>;
  parse(batchId: string, repName?: string | null): Promise<BulkParseResponse>;
  /** Start the (background) import. `needAck` when the first-upload acknowledgement is required. */
  startImport(batchId: string, decisions: unknown[], firstImportAck?: boolean): Promise<{ started: boolean; needAck?: boolean }>;
  status(batchId: string): Promise<BulkStatusResponse>;
  /** [FIX 2b] Best-effort delete of the staged batch when the rep leaves the review without importing. */
  abandon(batchId: string): Promise<void>;
}

export class BulkImportClient implements BulkImportApi {
  constructor(private readonly baseUrl: string = '') {}
  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  async uploadFile(batchId: string, index: number, name: string, bytes: Uint8Array): Promise<{ ok: boolean; tooLarge?: boolean }> {
    // [FIX 1 / FOLLOW-UP 1] Raw binary — the bytes ARE the body; metadata rides in X-Tovira-* HEADERS,
    // never the URL (a file name is personal data; query strings land in access logs).
    const res = await fetch(`${this.baseUrl}/import/bulk/files`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/octet-stream', 'X-Tovira-Batch-Id': batchId, 'X-Tovira-Index': String(index), 'X-Tovira-Name': encodeURIComponent(name) },
      body: bytes as unknown as BodyInit,
    });
    if (res.status === 413) return { ok: false, tooLarge: true };
    return { ok: res.status === 200 };
  }

  async parse(batchId: string, repName?: string | null): Promise<BulkParseResponse> {
    const res = await this.post('/import/bulk/parse', { batchId, repName });
    return (await res.json()) as BulkParseResponse;
  }

  async startImport(batchId: string, decisions: unknown[], firstImportAck?: boolean): Promise<{ started: boolean; needAck?: boolean }> {
    const res = await this.post('/import/bulk', { batchId, decisions, ...(firstImportAck ? { firstImportAck: true } : {}) });
    if (res.status === 428) return { started: false, needAck: true };
    return { started: res.status === 202 };
  }

  async status(batchId: string): Promise<BulkStatusResponse> {
    const res = await fetch(`${this.baseUrl}/import/bulk/${encodeURIComponent(batchId)}/status`, { credentials: 'include' });
    return (await res.json()) as BulkStatusResponse;
  }

  async abandon(batchId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/import/bulk/${encodeURIComponent(batchId)}`, { method: 'DELETE', credentials: 'include' });
    } catch { /* best effort — the 24h retention sweep is the backstop */ }
  }
}
