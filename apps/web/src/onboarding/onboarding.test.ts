import { describe, it, expect } from 'vitest';
import { onboardingStep, detectStandalone } from './onboarding.js';

describe('[P3-6] onboarding guidance', () => {
  // NEGATIVE: skipping install → told notifications won't work + fallback pointer.
  it('tells the rep to install and points at the in-app fallback when not installed', () => {
    const step = onboardingStep({ standalone: false, notificationPermission: 'default', pushSupported: true });
    expect(step.stage).toBe('install');
    expect(step.message).toMatch(/home screen/i);
    expect(step.message).toMatch(/going cold|in-app|any time/i); // fallback pointer
  });

  it('prompts to enable notifications once installed', () => {
    const step = onboardingStep({ standalone: true, notificationPermission: 'default', pushSupported: true });
    expect(step.stage).toBe('enable');
  });

  it('is ready when installed and permission granted', () => {
    const step = onboardingStep({ standalone: true, notificationPermission: 'granted', pushSupported: true });
    expect(step.stage).toBe('ready');
  });

  it('handles a browser without push support by pointing at the fallback', () => {
    const step = onboardingStep({ standalone: true, notificationPermission: 'default', pushSupported: false });
    expect(step.stage).toBe('install');
  });

  it('detects iOS standalone via navigator.standalone', () => {
    expect(detectStandalone({ navigator: { standalone: true } })).toBe(true);
    expect(detectStandalone({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });
});
