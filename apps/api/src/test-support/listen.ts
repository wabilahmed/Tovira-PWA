import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

/**
 * [test infra] Start a test server so that only it can answer the test's requests.
 *  - Binds 127.0.0.1 explicitly on port 0 (a free port the OS picks). A wildcard bind on a random port could share the
 *    number with a stray local server holding 127.0.0.1, which then answered the tests (the port-clash flake).
 *  - Stamps every response with a per-server random token (x-test-server), and probes once: if the answer does not
 *    carry the token, another server answered, and the test refuses to start.
 * Returns the base URL ("http://127.0.0.1:<port>").
 */
export async function listenForTest(server: Server, opts: { probe?: (url: string) => Promise<Response> } = {}): Promise<string> {
  const token = randomBytes(16).toString('hex');
  server.prependListener('request', (_req, res) => { res.setHeader('x-test-server', token); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const { address, port } = server.address() as AddressInfo;
  if (address !== '127.0.0.1') throw new Error(`test server bound ${address}, not 127.0.0.1`);
  const base = `http://127.0.0.1:${port}`;
  const res = await (opts.probe ?? fetch)(`${base}/__test-probe__`);
  await res.arrayBuffer().catch(() => undefined);
  if (res.headers.get('x-test-server') !== token) throw new Error(`port ${port} answered, but not our server (no matching x-test-server token)`);
  return base;
}
