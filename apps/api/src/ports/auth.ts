/**
 * Port: authentication. Local dev uses a stub; prod uses Cognito — swappable
 * behind this interface.
 */

export interface Identity {
  userId: string;
}

export interface AuthProvider {
  /** Resolve a bearer token to an identity, or null if invalid/expired. */
  verifyToken(token: string): Promise<Identity | null>;
}
