/** Client for the per-client image gallery (P4-6). */

export interface ImageRecord {
  id: string;
  clientId: string;
  contentType: string;
  createdAt: number;
}

export class ImagesClient {
  constructor(private readonly baseUrl: string = '') {}

  async list(clientId: string): Promise<ImageRecord[]> {
    try {
      const res = await fetch(`${this.baseUrl}/clients/${clientId}/images`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { images: ImageRecord[] }).images;
    } catch {
      return [];
    }
  }

  async upload(clientId: string, image: Blob): Promise<ImageRecord | null> {
    try {
      const res = await fetch(`${this.baseUrl}/clients/${clientId}/images`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': image.type || 'application/octet-stream' },
        body: image,
      });
      if (res.status !== 201) return null;
      return (await res.json()) as ImageRecord;
    } catch {
      return null;
    }
  }

  /** Same-origin URL for an image's bytes (served to the owner only). */
  url(id: string): string {
    return `${this.baseUrl}/images/${id}`;
  }
}
