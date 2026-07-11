/**
 * Port: blob storage (voice audio, gallery images). Local dev uses the
 * filesystem; prod uses S3 — swappable behind this interface.
 */

export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}
