import { useEffect, useState } from 'react';
import type { ImageRecord } from './imagesClient.js';

export interface ImagesApi {
  list(clientId: string): Promise<ImageRecord[]>;
  upload(clientId: string, image: Blob): Promise<ImageRecord | null>;
  url(id: string): string;
}

/** Per-client image gallery (P4-6). */
export function Gallery({ clientId, api }: { clientId: string; api: ImagesApi }): JSX.Element {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = (): Promise<void> => api.list(clientId).then((imgs) => { setImages(imgs); setLoading(false); });
  useEffect(() => {
    void load();
  }, [api, clientId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const created = await api.upload(clientId, file);
    if (!created) {
      setError('Upload failed — please try again.');
      return;
    }
    void load();
  }

  return (
    <section aria-label="Gallery">
      <h3 style={{ marginBottom: '0.5rem' }}>Photos</h3>
      <label>
        Add a photo
        <input type="file" accept="image/*" aria-label="Add a photo" onChange={onFile} />
      </label>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      {loading ? (
        <p>Loading photos…</p>
      ) : images.length === 0 ? (
        <p style={{ color: '#666' }}>No photos yet.</p>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {images.map((img) => (
            <img key={img.id} src={api.url(img.id)} alt="Client photo" width={96} height={96} style={{ objectFit: 'cover', borderRadius: 6 }} />
          ))}
        </div>
      )}
    </section>
  );
}
