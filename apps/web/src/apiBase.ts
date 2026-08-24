/**
 * Every API call is made under this prefix so that, behind CloudFront, a single
 * `/api/*` cache behavior forwards the whole API to the ALB (the rest of the
 * distribution serves the static PWA from S3). The API server strips the `/api`
 * prefix, so routing is identical in local dev and in tests. In dev, Vite proxies
 * `/api` to the API container (see vite.config.ts).
 */
export const API_BASE = '/api';
