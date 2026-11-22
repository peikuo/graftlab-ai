// HTTP helpers. Same-origin requests with the session cookie; the server checks Origin and the lease (R28.6).

export interface QueueView {
  role: "operator" | "queued" | "watching";
  position?: number;
  queueLength: number;
  open: boolean;
}

async function post<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, status: 0, error: `network error: ${(e as Error).message}` };
  }
}

let sessionOnce: ReturnType<typeof post<{ ok: boolean; queue: QueueView }>> | null = null;
export const api = {
  // One request per page: two concurrent calls (React StrictMode runs effects twice in development) would create
  // two sessions, and the stream could be tied to a different session than the cookie (seen 2026-11-24).
  session: () => (sessionOnce ??= post<{ ok: boolean; queue: QueueView }>("/api/session").then(
    (r) => {
      if (!r.ok) sessionOnce = null; // a failed request may be tried again
      return r;
    },
    (e: unknown) => {
      sessionOnce = null;
      throw e;
    },
  )),
  join: () => post<QueueView>("/api/queue/join"),
  heartbeat: () => post<QueueView>("/api/queue/heartbeat"),
  leave: () => post<QueueView>("/api/queue/leave"),
  message: (taskId: string, to: string, text: string) => post<{ accepted: boolean; clientMsgId: string }>(`/api/tasks/${encodeURIComponent(taskId)}/messages`, { to, text }),
  answer: (taskId: string, cardId: string, answer: { optionId?: string; text?: string }) =>
    post<{ accepted: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/cards/${encodeURIComponent(cardId)}/answer`, answer),
  playFixture: (name: string, speed: number) => post<{ taskId: string }>("/api/dev/fixture", { name, speed }),
  createTask: (url: string) => post<{ taskId: string }>("/api/tasks", { url }),
  abort: (taskId: string) => post<{ accepted: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/abort`),
  endGathering: (taskId: string) => post<{ accepted: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/gathering/end`),
  async status(): Promise<{ liveExecution: boolean; reason?: string; creating: boolean } | null> {
    try {
      const r = await fetch("/api/status", { credentials: "same-origin" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  },
  async fileText(taskId: string, path: string): Promise<string | null> {
    try {
      const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/files?path=${encodeURIComponent(path)}`, { credentials: "same-origin" });
      if (!r.ok) return null;
      return ((await r.json()) as { text: string }).text;
    } catch {
      return null;
    }
  },
};
