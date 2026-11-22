// GraftLab AI backend entry. Milestone 2 only exposes a health route; the event store,
// SSE and the task runner follow in milestone 3 (tasks.md).
import Fastify from "fastify";
import { NODE_IDS } from "@graftlab/shared";

const port = Number(process.env.GL_PORT ?? 8080);
const host = process.env.GL_HOST ?? "127.0.0.1";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ ok: true, flowNodes: NODE_IDS.length }));

await app.listen({ port, host });
