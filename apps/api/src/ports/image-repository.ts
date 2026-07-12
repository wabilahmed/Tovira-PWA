/** Port: per-client gallery images (P4-6). Tenant-scoped; RLS on Postgres. */
export interface ImageRecord {
  id: string;
  userId: string;
  clientId: string;
  storageKey: string;
  contentType: string;
  createdAt: number;
}

export interface NewImage {
  clientId: string;
  storageKey: string;
  contentType: string;
}

export interface ImageRepository {
  create(userId: string, image: NewImage): Promise<ImageRecord>;
  listByClient(userId: string, clientId: string): Promise<ImageRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<ImageRecord | null>;
}
