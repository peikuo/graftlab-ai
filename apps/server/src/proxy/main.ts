// LLM_Proxy container entry. Bundled into one file (`npm run build:proxy -w apps/server`) and run on the
// dev-sandbox image. The server starts it per Task with these variables in the container environment:
//   GL_PROXY_CREDENTIAL      per-Task credential of the agents in the Development_Sandbox
//   GL_PROXY_APP_CREDENTIAL  optional per-Task credential of the changed app (run and test containers)
//   GL_PROXY_UPSTREAM_URL    the real OpenAI-compatible base address
//   GL_PROXY_UPSTREAM_KEY    the real key
//   GL_PROXY_PORT            listening port (default 8787)
//   GL_RELAY_PORT, GL_RELAY_TARGET   optional port relay: listen port and host:port on the internal network
// A missing variable stops the process with its name (never a value).
import { createProxyServer } from "./proxy.js";
import { createRelay, parseTarget } from "./relay.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`llm-proxy: missing ${name}\n`);
    process.exit(2);
  }
  return v;
}

const server = createProxyServer({
  credential: required("GL_PROXY_CREDENTIAL"),
  ...(process.env.GL_PROXY_APP_CREDENTIAL ? { appCredential: process.env.GL_PROXY_APP_CREDENTIAL } : {}),
  upstreamBaseUrl: required("GL_PROXY_UPSTREAM_URL"),
  upstreamKey: required("GL_PROXY_UPSTREAM_KEY"),
});
const port = Number(process.env.GL_PROXY_PORT ?? 8787);
server.listen(port, "0.0.0.0", () => process.stdout.write(`llm-proxy listening on ${port}\n`));
if (process.env.GL_RELAY_PORT && process.env.GL_RELAY_TARGET) {
  const relayPort = Number(process.env.GL_RELAY_PORT);
  createRelay(parseTarget(process.env.GL_RELAY_TARGET), (l) => process.stdout.write(`${l}\n`)).listen(relayPort, "0.0.0.0", () =>
    process.stdout.write(`relay listening on ${relayPort}\n`),
  );
}
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => process.exit(0)));
