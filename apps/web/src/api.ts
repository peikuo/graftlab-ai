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

export const api = {
  session: () => post<{ ok: boolean; queue: QueueView }>("/api/session"),
  join: () => post<QueueView>("/api/queue/join"),
  heartbeat: () => post<QueueView>("/api/queue/heartbeat"),
  leave: () => post<QueueView>("/api/queue/leave"),
  message: (taskId: string, to: string, text: string) => post<{ accepted: boolean; clientMsgId: string }>(`/api/tasks/${encodeURIComponent(taskId)}/messages`, { to, text }),
  answer: (taskId: string, cardId: string, answer: { optionId?: string; text?: string }) =>
    post<{ accepted: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/cards/${encodeURIComponent(cardId)}/answer`, answer),
  playFixture: (name: string, speed: number) => post<{ taskId: string }>("/api/dev/fixture", { name, speed }),
};
