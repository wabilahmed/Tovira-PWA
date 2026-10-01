import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Storage } from '../../ports/storage.js';

/** The slice of the S3 client this adapter uses. Narrow + injectable so tests can drive the adapter
 *  with an in-memory fake that has the same semantics (not a call-assertion mock). */
export interface S3SendClient {
  send(command: object): Promise<unknown>;
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Inject a client in tests; production uses a real S3Client built from `region`. */
  client?: S3SendClient;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * S3-backed blob storage (production). Same contract as FsStorage/InMemoryStorage: get() of a missing
 * key THROWS (callers like transcription treat that as a missing object), delete() is idempotent. Key
 * layout is unchanged — audio/<userId>/<uuid>.webm and images/<userId>/<uuid>. Uses the bucket
 * provisioned as S3_MEDIA_BUCKET; provisions no infrastructure.
 */
export class S3Storage implements Storage {
  private readonly client: S3SendClient;
  private readonly bucket: string;

  constructor(opts: S3StorageOptions) {
    this.bucket = opts.bucket;
    this.client = opts.client ?? (new S3Client({ region: opts.region }) as unknown as S3SendClient);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }

  async get(key: string): Promise<Uint8Array> {
    // GetObject throws NoSuchKey for a missing object — propagate it (the port contract is "get of a
    // missing key throws", matching fs/in-memory).
    const res = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))) as {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
    };
    if (!res.Body) throw new Error(`no such object: ${key}`);
    return res.Body.transformToByteArray();
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent: deleting a missing key returns 204, not an error.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
