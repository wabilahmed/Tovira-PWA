import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { ImageRepository } from '../ports/image-repository.js';
import type { Storage } from '../ports/storage.js';
import { BadJsonError, extractToken, readRawBody, sendJson } from './helpers.js';
import { isAllowedImage, looksLikeAudio, AUDIO_ELSEWHERE_MESSAGE, NOT_AN_IMAGE_MESSAGE } from '../services/media/sniff.js';

export interface ImageRouteDeps {
  auth: AuthService;
  clients: ClientRepository;
  images: ImageRepository;
  storage: Storage;
}

const UPLOAD_RE = /^\/clients\/([^/]+)\/images$/;
const IMAGE_RE = /^\/images\/([^/]+)$/;

export async function handleImageRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ImageRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const upload = method === 'POST' ? UPLOAD_RE.exec(path) : null;
  const list = method === 'GET' ? UPLOAD_RE.exec(path) : null;
  const getOne = method === 'GET' ? IMAGE_RE.exec(path) : null;
  if (!upload && !list && !getOne) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  try {
    if (upload) {
      const clientId = decodeURIComponent(upload[1]!);
      if (!(await deps.clients.findByIdForUser(userId, clientId))) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const bytes = await readRawBody(req);
      if (bytes.length === 0) {
        sendJson(res, 400, { error: 'validation', message: 'No image was uploaded.' });
        return true;
      }
      // [IMAGES-GATE] Allow-list by ACTUAL bytes, not the content-type header or extension: accept only
      // real images (PNG/JPEG/WebP/HEIC). Audio (incl. opus bytes sent as image/png) is refused with the
      // voice message; any other non-image with a plain not-an-image message. Closes audio-via-images.
      const u8 = new Uint8Array(bytes);
      if (!isAllowedImage(u8)) {
        sendJson(res, 415, { error: 'unsupported_media', message: looksLikeAudio(u8) ? AUDIO_ELSEWHERE_MESSAGE : NOT_AN_IMAGE_MESSAGE });
        return true;
      }
      const contentType = req.headers['content-type'] ?? 'application/octet-stream';
      const storageKey = `images/${userId}/${randomUUID()}`;
      await deps.storage.put(storageKey, new Uint8Array(bytes));
      const image = await deps.images.create(userId, { clientId, storageKey, contentType });
      await deps.clients.touch(userId, clientId);
      sendJson(res, 201, image);
      return true;
    }

    if (list) {
      const clientId = decodeURIComponent(list[1]!);
      sendJson(res, 200, { images: await deps.images.listByClient(userId, clientId) });
      return true;
    }

    // GET /images/:id — serve bytes, only to the owner.
    const image = await deps.images.findByIdForUser(userId, decodeURIComponent(getOne![1]!));
    if (!image || !(await deps.storage.exists(image.storageKey))) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    const bytes = await deps.storage.get(image.storageKey);
    res.writeHead(200, { 'content-type': image.contentType, 'content-length': String(bytes.byteLength) });
    res.end(Buffer.from(bytes));
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid upload.' });
      return true;
    }
    throw err;
  }
}
