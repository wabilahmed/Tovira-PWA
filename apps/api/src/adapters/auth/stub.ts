import type { AuthProvider, Identity } from '../../ports/auth.js';

/**
 * Local stand-in for Cognito. A token is `stub:<userId>`. Good enough to
 * develop the whole app against a "logged-in rep" without real auth infra.
 */
export class StubAuthProvider implements AuthProvider {
  async verifyToken(token: string): Promise<Identity | null> {
    const match = /^stub:(.+)$/.exec(token.trim());
    if (!match) return null;
    const userId = match[1]!.trim();
    return userId ? { userId } : null;
  }
}
