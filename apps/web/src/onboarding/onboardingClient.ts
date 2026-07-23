/** Client for the day-one seeding status (P5-3). Same-origin, cookie session. */

export interface SeedingFallback {
  kind: string;
  label: string;
}

export interface SeedingStatus {
  hasClient: boolean;
  hasNote: boolean;
  briefReachable: boolean;
  seeded: boolean;
  bookScanReady: boolean;
  nextStep: string;
  seeding: {
    primary: string;
    requiresPasteEntry: boolean;
    steps: { android: string[]; ios: string[] };
  };
  fallbacks: SeedingFallback[];
}

export class OnboardingClient {
  constructor(private readonly baseUrl: string = '') {}

  async status(): Promise<SeedingStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/onboarding/status`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as SeedingStatus;
    } catch {
      return null;
    }
  }
}
