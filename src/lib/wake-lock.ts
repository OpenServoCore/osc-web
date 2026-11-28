/**
 * Keeps the screen on until the returned release is called. The browser
 * drops the lock whenever the tab is hidden, so it is asked for again each
 * time the tab comes back; a browser without the API, or one that refuses,
 * just goes without.
 */
export function holdScreen(nav: Navigator = navigator, doc: Document = document): () => void {
  let held = true;
  let sentinel: WakeLockSentinel | undefined;
  const ask = () => {
    if (!held || doc.visibilityState !== "visible" || !("wakeLock" in nav)) return;
    nav.wakeLock.request("screen").then(
      (s) => {
        if (held) sentinel = s;
        else void s.release().catch(() => undefined);
      },
      () => undefined,
    );
  };
  doc.addEventListener("visibilitychange", ask);
  ask();
  return () => {
    held = false;
    doc.removeEventListener("visibilitychange", ask);
    void sentinel?.release().catch(() => undefined);
    sentinel = undefined;
  };
}
