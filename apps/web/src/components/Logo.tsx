/**
 * [P89 · owner, Prompt 86] The Marker logo (plan/brand.md "Logo"): a black disc holding a T, a white stem under a level
 * yellow bar that floats just above it, then "Tovira" in Geist 600. The same drawing as src/marketing/marker.ts
 * discSvg(), as a React component, for the app's public screens (sign-in, request access, …). The disc is decorative;
 * the text stays plain "Tovira" for screen readers and tests.
 */
export function LogoDisc({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <svg className="tov-logo__disc" width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <circle cx="15" cy="15" r="15" fill="#0A0A0A" />
      <rect x="6" y="7" width="18" height="6" rx="1.5" fill="#FFE45C" />
      <rect x="12" y="15" width="6" height="9" rx="1.5" fill="#FFFFFF" />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <span className="tov-logo"><LogoDisc size={size} />Tovira</span>
  );
}
