/**
 * The Tovira wordmark with the T and v accented in brass — matches the marketing
 * site header (SITE2). Renders as inline spans, so it drops into any heading or
 * brand slot; its textContent stays plain "Tovira" for accessibility and tests.
 */
export function Wordmark(): JSX.Element {
  return (
    <>
      <span className="tov-wordmark__accent">T</span>o<span className="tov-wordmark__accent">v</span>ira
    </>
  );
}
