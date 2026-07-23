/** Client for the in-app proactive surface: alerts + the cold list (P3-3/P3-5). */

export interface ColdClient {
  id: string;
  name: string;
  createdAt: number;
  lastTouchedAt: number;
}

export interface Notification {
  id: string;
  type: 'pre_meeting_nudge' | 'going_cold' | 'date_reminder';
  clientId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
}

export class ProactiveClient {
  constructor(private readonly baseUrl: string = '') {}

  async listCold(): Promise<ColdClient[]> {
    try {
      const res = await fetch(`${this.baseUrl}/cold`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { clients: ColdClient[] }).clients;
    } catch {
      return [];
    }
  }

  async listNotifications(): Promise<Notification[]> {
    try {
      const res = await fetch(`${this.baseUrl}/notifications`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { notifications: Notification[] }).notifications;
    } catch {
      return [];
    }
  }

  /** Re-run the daily scan on demand (idempotent server-side). */
  async runScan(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/scan`, { method: 'POST', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
