// "Backend unreachable" (design.md, Error Handling; R6.4, R32.7). Derived from the live connection only: the banner
// shows after the stream has been down for a few seconds, with the real time since it was last connected.
import { useEffect, useRef } from "react";

export const DOWN_AFTER_MS = 8000;

/** Seconds the backend has been unreachable, or null while connected or within the grace period. */
export function downSeconds(connected: boolean, downSince: number | null, now: number): number | null {
  if (connected || downSince === null) return null;
  const ms = now - downSince;
  return ms >= DOWN_AFTER_MS ? Math.floor(ms / 1000) : null;
}

export function useBackendDown(connected: boolean, now: number): number | null {
  // Counted from page load until the first connection, so a backend that is off from the start is shown too.
  const since = useRef<number | null>(Date.now());
  useEffect(() => {
    if (connected) since.current = null;
    else since.current ??= Date.now();
  }, [connected]);
  return downSeconds(connected, since.current, now);
}

export function BackendBanner({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null;
  return (
    <div className="banner failure-text" role="alert">
      <strong>Backend unreachable</strong> for {seconds} s. The Studio's backend runs on the team's machine and is not answering right now; this page keeps retrying. Commands cannot be sent meanwhile. Recorded Replays still play.
    </div>
  );
}
