// GraftLab AI backend entry. Milestone 3: event store, SSE, queue lease and, in development, the fixture player.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pingDocker } from "./containers/engine.ts";
import { ContainerManager, executionEnabled } from "./containers/manager.ts";
import { SandboxService } from "./containers/sandboxService.ts";
import { priceFromFile, resolveLlmConfig } from "./llm/config.ts";
import { setTurnTraceSink } from "./runtime/pi.ts";
import { TraceWriter } from "./trace/trace.ts";
import { buildStudioModel } from "./llm/model.ts";
import { piMemoWriter } from "./reader/memoWriter.ts";
import { loadRuntimeRules } from "./roles/rules.ts";
import { runAgentTurn } from "./runtime/pi.ts";
import { Lease } from "./queue/lease.ts";
import { GitHub } from "./reader/github.ts";
import { DEFAULT_LIMITS, TaskService } from "./tasks/service.ts";
import { loadAdapters } from "./adapters/registry.ts";
import { SecretRegistry } from "@graftlab/shared";
import { z } from "zod";
import { EventStore } from "./events/store.ts";
import { loadFixture, playFixture } from "./dev/fixturePlayer.ts";
import { AccessCodes, parseAccessCodes } from "./queue/access.ts";
import { createStudio } from "./http/app.ts";
import { readSession } from "./http/session.ts";

// Environment is loaded by the server process only; values are never logged or printed.
const envFile = process.env.GL_ENV_FILE ?? ".env";
if (existsSync(envFile)) process.loadEnvFile(envFile);

const llm = resolveLlmConfig(process.env);
const secrets = new SecretRegistry();
// Every LLM key of every profile is registered, so none can leak even if the profile is switched later.
for (const k of llm.allKeys) secrets.register(k.name, k.value);
// R28.7: access codes are secrets like keys; a code that reached a log would be redacted and reported.
const accessCodes = parseAccessCodes(process.env.GL_ACCESS_CODES);
accessCodes.forEach((c, i) => secrets.register(`access_code_${i + 1}`, c));
for (const [name, key] of [["github_token", "GITHUB_TOKEN"], ["admin_token", "GL_ADMIN_TOKEN"]] as const) {
  const v = process.env[key];
  if (v) secrets.register(name, v);
}

const root = resolve(import.meta.dirname, "../../..");
const dataDir = process.env.GL_DATA_DIR ?? join(root, "data");
const pricesFile = join(dataDir, "config", "llm-prices.json");
const llmPrice = priceFromFile(existsSync(pricesFile) ? readFileSync(pricesFile, "utf8") : null, llm.model);
const dev = process.env.GL_DEV === "1";
const port = Number(process.env.GL_PORT ?? 8080);
const host = process.env.GL_HOST ?? "127.0.0.1";

const runtimeRulesVersion = (await readFile(join(root, "runtime-rules/VERSION"), "utf8")).trim();
const rules = await loadRuntimeRules(join(root, "runtime-rules"), ["reader", "facilitator", "user_value", "feasibility", "risk", "planner", "reviewer", "code_agent", "test_agent", "explorer"]);
// The Reader needs a key; without one the reading step stops honestly after the download.
const model = llm.apiKey ? buildStudioModel(llm, process.env.GL_MAX_TOKENS ? { maxTokens: Number(process.env.GL_MAX_TOKENS) } : {}) : null;
const envInt = (name: string) => (process.env[name] ? Number(process.env[name]) : undefined);
let hub: { delta(messageId: string, channel: "text" | "reasoning" | "toolcall", text: string): void } | null = null;
const lease = new Lease({ idleReleaseMs: Number(process.env.GL_LEASE_IDLE_S ?? 120) * 1000 });
let setCurrent: (store: EventStore) => void = () => {};
// R35: the local prompt trace of the current Task (data/tasks/<id>/traces/), never an event or a Replay part.
let traceTaskId: string | null = null;
const adapters = await loadAdapters(join(root, "adapters"));
const execution = executionEnabled();
const containers = execution ? new ContainerManager() : null;
const sandbox = new SandboxService();
const traces = new TraceWriter(dataDir, secrets, () => traceTaskId);
if (process.env.GL_TRACE !== "0") setTurnTraceSink((t) => traces.turn(t));
const tasks = new TaskService({
  dataDir,
  secrets,
  // The token is read from the environment by this process only and used only in GitHub request headers.
  github: new GitHub({
    ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    ...(process.env.GL_GITHUB_API ? { apiBase: process.env.GL_GITHUB_API } : {}),
    ...(process.env.GL_GITHUB_RAW ? { rawBase: process.env.GL_GITHUB_RAW } : {}),
  }),
  adapters,
  // Live development needs the engine and a key; the key goes only to the LLM_Proxy container (R30.16).
  ...(containers && llm.apiKey
    ? { execution: { manager: containers, devImage: process.env.GL_DEV_IMAGE ?? "graftlab/dev-sandbox-linkding:latest", llm: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model, reasoningParam: llm.reasoningParam, reasoningEffort: llm.reasoningEffort }, adapters, sandbox, ...(process.env.GL_TRACE !== "0" ? { traces } : {}) } }
    : {}),
  adaptersDir: join(root, "adapters"),
  replayPublicDir: join(root, "apps/web/public/replays"),
  runtimeRulesVersion,
  llm: { profile: llm.profile, model: llm.model, ...(llmPrice ? { price: llmPrice } : {}) },
  lease,
  onStore: (store) => {
    traceTaskId = store.taskId;
    setCurrent(store);
  },
  limits: {
    ...DEFAULT_LIMITS,
    ...(process.env.GL_READ_MAX_FILES ? { maxFiles: Number(process.env.GL_READ_MAX_FILES) } : {}),
    ...(process.env.GL_READ_MAX_BYTES ? { maxBytes: Number(process.env.GL_READ_MAX_BYTES) } : {}),
  },
  taskTimeoutMs: Number(process.env.GL_TASK_TIMEOUT_MIN ?? 90) * 60_000,
  ...(model
    ? {
        reader: {
          // The memo cache depends only on the text the Reader sees, so meeting rule edits keep it valid.
          promptVersion: `reader-${createHash("sha256").update(rules.shared).update("\0").update(rules.roles.reader ?? "").digest("hex").slice(0, 12)}`,
          makeWriter: (emit, idPrefix) => piMemoWriter({ model, rules, emit, idPrefix, ...(hub ? { hub } : {}) }),
          ...(envInt("GL_BRIEF_FILES") || envInt("GL_BRIEF_KB") ? { caps: { maxFiles: envInt("GL_BRIEF_FILES") ?? 30, maxBytes: (envInt("GL_BRIEF_KB") ?? 160) * 1024 } } : {}),
          ...(envInt("GL_MEMO_CONCURRENCY") ? { concurrency: envInt("GL_MEMO_CONCURRENCY")! } : {}),
          ...(envInt("GL_INDEX_CONCURRENCY") ? { indexConcurrency: envInt("GL_INDEX_CONCURRENCY")! } : {}),
        },
        meeting: {
          rules,
          runTurn: (o) => runAgentTurn({ thinkingLevel: "low", ...o, model, ...(hub ? { hub } : {}), maxToolErrors: 3 }),
          ...(envInt("GL_MEETING_MAX_STATEMENTS") ? { maxStatements: envInt("GL_MEETING_MAX_STATEMENTS")! } : {}),
          ...(envInt("GL_MEETING_MAX_MIN") ? { maxMs: envInt("GL_MEETING_MAX_MIN")! * 60_000 } : {}),
        },
      }
    : {}),
});
const closed = await tasks.closeInterrupted();
// Live execution (R25.8): off with GL_EXECUTION_ENABLED=false; otherwise the engine is pinged, and resources left by
// a previous process (all carry the graftlab.managed label) are removed, because their Tasks were closed above.
if (containers && (await containers.docker.ping())) await containers.removeAll().catch(() => {});

const studio = createStudio({
  secrets,
  dataDir,
  lease,
  tasks,
  liveExecution: () => (execution ? pingDocker() : Promise.resolve({ available: false, reason: "live execution is turned off on this server" })),
  sandbox,
  llm: { profile: llm.profile, model: llm.model, keySet: !!llm.apiKey },
  logger: true,
  allowedOrigins: (process.env.GL_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  secureCookie: process.env.GL_SECURE_COOKIE === "1",
  access: new AccessCodes({ codes: accessCodes, ...(process.env.GL_ACCESS_CODE_DAILY_TASKS ? { dailyTasks: Number(process.env.GL_ACCESS_CODE_DAILY_TASKS) } : {}) }),
  ...(process.env.GL_ADMIN_TOKEN ? { adminToken: process.env.GL_ADMIN_TOKEN } : {}),
});
const { app } = studio;
setCurrent = (store) => studio.setCurrent(store);
hub = studio.hub;
app.log.info({ msg: "LLM profile", profile: llm.profile, model: llm.model, keySet: !!llm.apiKey });
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
