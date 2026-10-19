/**
 * [P33] Client for the ops beta access-request API (/ops/access-requests). Every call carries the ops token the
 * owner typed into the page (header x-ops-token); the API refuses anything without it (403). The page holds
 * no credential of its own.
 */
export type OpsAccessStatus = 'pending' | 'approved' | 'rejected' | 'invited' | 'activated';

export interface OpsAccessRequest {
  id: string;
  fullName: string;
  workEmail: string;
  phone: string;
  companyName: string;
  roleTitle: string;
  ownership: 'owns_or_manages' | 'employed';
  tradeLicenceNumber: string | null;
  conversationOwnership: string;
  conversationOwnershipOther: string | null;
  expectedVolume: string;
  createdAt: number;
  status: OpsAccessStatus;
  reviewedAt: number | null;
  reviewedNote: string | null;
  linkedUserId: string | null;
}

/** The ops token was refused (wrong, or ops is not configured on the server). */
export class OpsUnauthorizedError extends Error {
  constructor() {
    super('ops token refused');
    this.name = 'OpsUnauthorizedError';
  }
}

export interface OpsAccessApi {
  list(token: string, status?: OpsAccessStatus): Promise<OpsAccessRequest[]>;
  approve(token: string, id: string): Promise<OpsAccessRequest>;
  reject(token: string, id: string, note: string): Promise<OpsAccessRequest>;
  reinvite(token: string, id: string): Promise<OpsAccessRequest>;
}

export class HttpOpsAccessClient implements OpsAccessApi {
  constructor(private readonly baseUrl: string = '') {}

  private async call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'x-ops-token': token, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      credentials: 'omit', // the ops token is the only credential — never the rep session cookie
    });
    if (res.status === 403) throw new OpsUnauthorizedError();
    const body = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
    if (!res.ok) throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
    return body;
  }

  async list(token: string, status?: OpsAccessStatus): Promise<OpsAccessRequest[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return (await this.call<{ requests: OpsAccessRequest[] }>(token, `/ops/access-requests${q}`)).requests;
  }
  async approve(token: string, id: string): Promise<OpsAccessRequest> {
    return (await this.call<{ request: OpsAccessRequest }>(token, `/ops/access-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ reviewedBy: 'owner (ops page)' }) })).request;
  }
  async reject(token: string, id: string, note: string): Promise<OpsAccessRequest> {
    return (await this.call<{ request: OpsAccessRequest }>(token, `/ops/access-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ note }) })).request;
  }
  async reinvite(token: string, id: string): Promise<OpsAccessRequest> {
    return (await this.call<{ request: OpsAccessRequest }>(token, `/ops/access-requests/${encodeURIComponent(id)}/reinvite`, { method: 'POST', body: JSON.stringify({ reviewedBy: 'owner (ops page)' }) })).request;
  }
}
