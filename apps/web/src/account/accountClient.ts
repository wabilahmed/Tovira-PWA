/** Client for data trust & control — export and delete (P5-4). */

export class AccountClient {
  constructor(private readonly baseUrl: string = '') {}

  async exportData(): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.baseUrl}/account/export`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async deleteAccount(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/account`, { method: 'DELETE', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
