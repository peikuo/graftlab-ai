# Deploying the Studio

Background and requirements: `.kiro/specs/graftlab-ai/reference-deployment.md`, section "Public deployment".

The Studio has two parts:

- **Backend**: a Node 24 process on a host with a Docker engine. It runs the Task flow and starts the per-Task containers (Sandbox, Development_Sandbox, Run_Environment, LLM_Proxy) through the engine's API. It does not run in a container itself, so no container ever gets the Docker socket.
- **Front end**: nginx serving the web build and the published Replays, and proxying `/api` to the backend on the same origin.

## 1. Backend

```sh
npm ci
cp .env.example .env        # fill in LLM_BASE_URL, LLM_MODEL, LLM_API_KEY, GITHUB_TOKEN and the GL_* values you need
GL_HOST=127.0.0.1 GL_PORT=8080 npm start -w apps/server
```

- Build the Development_Sandbox image once (`scripts/dev-sandbox-context.ts`, see `docker/dev-sandbox/`).
- For a public site set `GL_ACCESS_CODES` (comma-separated codes of at least 8 characters). Watching needs no code; starting a Task does, and each code may start `GL_ACCESS_CODE_DAILY_TASKS` Tasks per day (default 3).
- `GL_ADMIN_TOKEN` (at least 16 characters) enables `POST /api/admin/queue` (close or open the queue) and an admin Sandbox restore.
- Keep the backend on a private interface; only the front end should reach it.

## 2. Front end

```sh
npm run build -w apps/web
docker build -f deploy/front/Dockerfile -t graftlab-front .
docker run -d --name graftlab-front -p 127.0.0.1:8081:8080 \
  -e BACKEND_UPSTREAM=host.docker.internal:8080 \
  --add-host host.docker.internal:host-gateway \
  -v "$PWD/data/replay-publish:/usr/share/nginx/html/replays:ro" \
  graftlab-front
```

Put any TLS reverse proxy or CDN in front of port 8081. It must not buffer `text/event-stream` responses and must allow idle connections of at least 60 s (the backend sends a heartbeat event every 15 s).

## 3. Published Replays

```sh
npx tsx scripts/replay-publish.ts data/replays <taskId>...
```

This checks each Replay_File (label, secret patterns, private paths and addresses) and writes the chosen set with its screenshots and `index.json` to `data/replay-publish/`, which the front end serves at `/replays/`. Replays play without the backend.

No secrets are in these files; keys stay in the backend's environment.
