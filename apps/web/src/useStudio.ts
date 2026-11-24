// Live connection: SSE frames to events plus presentation-only state (delta buffers, connection, queue view).
// The UI state itself is foldEvents(events) (design.md, "Web app"); events at or below the last seq are ignored.
import { useEffect, useMemo, useRef, useState } from "react";
import { foldEvents, initialUiState, reduce, validateEvent, type StudioEvent, type UiState } from "@graftlab/shared";
import type { QueueView } from "./api.ts";

export interface LiveBuffer {
  text: string;
  reasoning: string;
}

export interface StudioConnection {
  state: UiState;
  events: StudioEvent[];
  buffers: Record<string, LiveBuffer>;
  connected: boolean;
  error: string | null;
  queue: QueueView | null;
  now: number;
}

/** `enabled` stays false until the session cookie exists, so the stream is tied to the session (queue frames). */
export function useStudio(enabled: boolean, url = "/api/tasks/current/stream"): StudioConnection {
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [state, setState] = useState<UiState>(initialUiState);
  const [buffers, setBuffers] = useState<Record<string, LiveBuffer>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const taskRef = useRef<string | undefined>(undefined);
  const lastSeq = useRef(0);
  // A dead connection (for example a dropped tunnel) can stay silent; the watchdog reopens the stream when no frame,
  // not even the server's heartbeat, arrived for 45 s, and asks for the events after the last one it has.
  const [attempt, setAttempt] = useState(0);

  // A clock for Role_Status ("waiting for LLM, 7 s"); the status itself is derived from events only.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const resume = lastSeq.current > 0 && taskRef.current ? `${url}${url.includes("?") ? "&" : "?"}last=${lastSeq.current}&task=${encodeURIComponent(taskRef.current)}` : url;
    const es = new EventSource(resume, { withCredentials: true });
    let lastFrame = Date.now();
    const seen = () => (lastFrame = Date.now());
    const watchdog = setInterval(() => {
      if (Date.now() - lastFrame > 45_000) {
        setConnected(false);
        setAttempt((a) => a + 1);
      }
    }, 5000);
    es.addEventListener("hb", seen);
    es.onopen = () => {
      setConnected(true);
      setError(null);
    };
    es.onerror = () => setConnected(false);
    es.addEventListener("event", (m) => {
      seen();
      const r = validateEvent(JSON.parse((m as MessageEvent).data));
      if (!r.ok) return setError(`an event did not match the schema: ${r.error.slice(0, 120)}`);
      const e = r.event;
      if (taskRef.current === e.taskId || taskRef.current === undefined) lastSeq.current = Math.max(lastSeq.current, e.seq);
      if (taskRef.current !== e.taskId) {
        lastSeq.current = e.seq;
        // A new Task started (for example a new fixture run): start over from its first event.
        taskRef.current = e.taskId;
        setEvents([e]);
        setState(foldEvents([e]));
        setBuffers({});
        return;
      }
      setEvents((prev) => (prev.length > 0 && e.seq <= prev.at(-1)!.seq ? prev : [...prev, e]));
      setState((s) => reduce(s, e));
      if (e.type === "message_completed" || e.type === "message_incomplete") {
        setBuffers((b) => {
          const { [e.payload.messageId]: _done, ...rest } = b;
          return rest;
        });
      }
    });
    es.addEventListener("delta", (m) => {
      seen();
      const d = JSON.parse((m as MessageEvent).data) as { messageId: string; channel: "text" | "reasoning" | "toolcall"; text: string };
      if (d.channel === "toolcall") return;
      const channel = d.channel;
      setBuffers((b) => {
        const cur = b[d.messageId] ?? { text: "", reasoning: "" };
        return { ...b, [d.messageId]: { ...cur, [channel]: cur[channel] + d.text } };
      });
    });
    es.addEventListener("buffer", (m) => {
      const list = JSON.parse((m as MessageEvent).data) as { messageId: string; text: string; reasoning: string }[];
      setBuffers(Object.fromEntries(list.map((x) => [x.messageId, { text: x.text, reasoning: x.reasoning }])));
    });
    es.addEventListener("queue", (m) => setQueue(JSON.parse((m as MessageEvent).data) as QueueView));
    es.addEventListener("error", (m) => {
      const data = (m as MessageEvent).data;
      if (typeof data === "string") setError((JSON.parse(data) as { message: string }).message);
    });
    return () => {
      clearInterval(watchdog);
      es.close();
    };
  }, [url, enabled, attempt]);

  return useMemo(() => ({ state, events, buffers, connected, error, queue, now }), [state, events, buffers, connected, error, queue, now]);
}
