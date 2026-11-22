// GraftLab AI backend entry. Milestone 3: event store, SSE, queue lease and, in development, the fixture player.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pingDocker } from "./containers/engine.ts";
import { Lease } from "./queue/lease.ts";
import { GitHub } from "./reader/github.ts";
import { DEFAULT_LIMITS, TaskService, loadAdapters } from "./tasks/service.ts";
import { SecretRegistry } from "@graftlab/shared";
import { z } from "zod";
import { EventStore } from "./events/store.ts";
import { loadFixture, playFixture } from "./dev/fixturePlayer.ts";
import { createStudio } from "./http/app.ts";
import { readSession } from "./http/session.ts";

// Environment is loaded by the server process only; values are never logged or printed.
const envFile = process.env.GL_ENV_FILE ?? ".env";
if (existsSync(envFile)) process.loadEnvFile(envFile);

const secrets = new SecretRegistry();
for (const [name, key] of [["llm_key", "LLM_API_KEY"], ["github_token", "GITHUB_TOKEN"], ["admin_token", "GL_ADMIN_TOKEN"]] as const) {
  const v = process.env[key];
  if (v) secrets.register(name, v);
}

const root = resolve(import.meta.dirname, "../../..");
const dataDir = process.env.GL_DATA_DIR ?? join(root, "data");
const dev = process.env.GL_DEV === "1";
const port = Number(process.env.GL_PORT ?? 8080);
const host = process.env.GL_HOST ?? "127.0.0.1";

const runtimeRulesVersion = (await readFile(join(root, "runtime-rules/VERSION"), "utf8")).trim();
const lease = new Lease({ idleReleaseMs: Number(process.env.GL_LEASE_IDLE_S ?? 120) * 1000 });
let setCurrent: (store: EventStore) => void = () => {};
const tasks = new TaskService({
  dataDir,
  secrets,
  // The token is read from the environment by this process only and used only in GitHub request headers.
  github: new GitHub({
    ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    ...(process.env.GL_GITHUB_API ? { apiBase: process.env.GL_GITHUB_API } : {}),
    ...(process.env.GL_GITHUB_RAW ? { rawBase: process.env.GL_GITHUB_RAW } : {}),
  }),
  adapters: await loadAdapters(join(root, "adapters")),
  runtimeRulesVersion,
  lease,
  onStore: (store) => setCurrent(store),
  limits: {
    ...DEFAULT_LIMITS,
    ...(process.env.GL_READ_MAX_FILES ? { maxFiles: Number(process.env.GL_READ_MAX_FILES) } : {}),
    ...(process.env.GL_READ_MAX_BYTES ? { maxBytes: Number(process.env.GL_READ_MAX_BYTES) } : {}),
  },
  taskTimeoutMs: Number(process.env.GL_TASK_TIMEOUT_MIN ?? 90) * 60_000,
});
const closed = await tasks.closeInterrupted();

const studio = createStudio({
  secrets,
  lease,
  tasks,
  liveExecution: () => pingDocker(),
  logger: true,
  allowedOrigins: (process.env.GL_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  secureCookie: process.env.GL_SECURE_COOKIE === "1",
  ...(process.env.GL_ADMIN_TOKEN ? { adminToken: process.env.GL_ADMIN_TOKEN } : {}),
});
const { app } = studio;
setCurrent = (store) => studio.setCurrent(store);
if (closed > 0) app.log.info({ msg: "closed Tasks left open by a previous process", count: closed });

app.get("/api/health", async () => ({ ok: true, dev }));

if (dev) {
  // Development only: play a fixture as the current Task. Operator lease required like every command.
  const Body = z.object({ name: z.string().regex(/^[a-z0-9-]+$/), speed: z.number().min(0.25).max(20).optional() });
  let running: AbortController | null = null;
  app.post("/api/dev/fixture", async (req, reply) => {
    if (!studio.lease.isOperator(readSession(req))) return reply.code(403).send({ error: "only the current operator can do this" });
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid body" });
    const file = join(root, "packages/shared/test/fixtures", `${body.data.name}.jsonl`);
    if (!existsSync(file)) return reply.code(404).send({ error: "no such fixture" });
    running?.abort();
    running = new AbortController();
    const lines = await loadFixture(file);
    const taskId = `fixture-${body.data.name}-${Date.now()}`;
    const store = await EventStore.open({ dataDir, taskId, secrets });
    studio.setCurrent(store);
    // A fixture is not a real Task, so it does not hold or release the operator lease.
    void playFixture(lines, store, studio.hub, { speed: body.data.speed ?? 1, signal: running.signal }).catch((e) =>
      app.log.error({ msg: "fixture playback failed", error: (e as Error).message }),
    );
    return { taskId, events: lines.length };
  });
}

await app.listen({ port, host });
