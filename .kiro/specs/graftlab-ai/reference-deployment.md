# Reference: deployment

> Purpose: how the Studio is deployed (the backend host and a public front end) and the environment facts found by the spikes.
> Status: Reference, not a decision record; [design.md](design.md) is authoritative.
> Implements these design.md sections: "Deployment model", "Containers", "Network policy", "Images", "Worktree manager", "Initial values" (container memory limits) and the "Backend unreachable" row of "Error Handling". Target-specific facts are in [reference-target-linkding.md](reference-target-linkding.md).
> Sources: the spike notes in `spike/results/` (`S-node.md`, `S-mirrors.md`, `S-linkding-image.md`, `S-docker-network.md`, `S-linkding-source.md`) recorded on 2026-11-21 by tasks 1.1-1.6 in [tasks.md](tasks.md). Development deployment is not the goal of the hackathon entry; it only has to work.

## Backend host (first measured on a Windows host with Docker Desktop)

### Backend and containers

- The Studio backend runs as a host Node process, not in a container. It talks to Docker Desktop through the Docker Engine API (the engine's default endpoint, a named pipe on Windows). No container gets the Docker socket, so no internet-facing component can start containers (R38.2, R39.1).
- The backend listens on the loopback interface and serves the web build and the API. `npm run build` then `npm start`. Configuration comes only from environment variables; `.env.example` lists them without values (R32.1, R33.4). All state lives under `data/` (R32.3).
- No Docker-in-Docker anywhere.

### Node

- The backend host had Node 22.14; pi needs Node >=22.19. A portable Node 24.22.3 was installed beside the system Node (SHA-256 checked against the nodejs.org `SHASUMS256.txt`); the system Node and `PATH` were not changed (Open item 47, task 1.1).
- The Studio start script must call the portable Node explicitly.
- Measured with this Node: pi-ai and pi-agent-core 1.5.2 ran streaming plus a tool call in 1.6 s (first delta after 730 ms), and abort stopped the run at 4.0 s.

### Docker Desktop and memory

- Docker Desktop with the WSL2 VM capped at 2 GB.
- Container memory limits (initial values, `GL_MEM_*_MB`; R38.3, Open item 25):

| Container | Memory limit |
|---|---|
| Sandbox | 512 MB |
| Development_Sandbox | 768 MB |
| Run_Environment | 512 MB |
| Verifier test container | 768 MB |
| LLM_Proxy (and the relay it hosts) | 64 MB |

- Only one Task runs at a time and containers that are not needed are stopped, so the peak is the Run_Environment or the test container plus the LLM_Proxy and, for API-operation stories, the Sandbox. Measured so far: the linkding Sandbox idles at about 85 MiB, and the linkding full test suite ran under 768 MiB without an OOM kill. Worst case measured in task 1.9 (2026-11-22): the Sandbox, a Run_Environment running linkding from source, the LLM_Proxy and the Code_Agent runner doing a story, all at once: peaks Sandbox 98 MiB, Run_Environment 120 MiB, LLM_Proxy 35 MiB, runner 110 MiB; the WSL VM (1971 MiB) peaked at 917 MiB used; no OOM kill. `docker stats` takes several seconds per sample (19 samples), so the peaks are approximate. The full test suite was not run at the same time; it ran alone under 768 MiB without an OOM kill (task 1.6).
- Playwright on the backend host (task 1.10): `npm install playwright` from registry.npmmirror.com took 18 s; `npx playwright install chromium` with `PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright` took 44 s.

### Docker Desktop facts (spike 1.4)

- A container attached only to a network created with `internal: true` cannot publish a port: the host connection is refused. That container has no internet and no DNS, as intended.
- Consequence, adopted in design.md ("Network policy"): a relay on the network boundary. A relay container on both the internal and the default network publishes the port on the loopback interface; host to relay to the internal app answered 200. The LLM_Proxy container can host this relay.
- Bind mount of a Windows directory at `/work`: the container's writes are visible on the host; LF line endings are preserved (0 CR bytes on both sides); 200 small writes took 329 ms; `git status` took 1.1 s on a 442-file tree. Every file appears as mode 755 inside the container, so git reports a mode change on every file unless `core.fileMode=false` is set (design.md, "Worktree manager"). Files are owned by uid 0.

### Operational notes

- Docker commands run from an SSH session need an empty `DOCKER_CONFIG` and a minimal `PATH`, because the Docker credential helper fails without a desktop logon session ("A specified logon session does not exist"). The backend running in the desktop session is not affected.
- Setting `DOCKER_HOST` made buildx start a separate BuildKit container that cannot see local images. Build images with the default builder and without `DOCKER_HOST`.

## Network facts (spikes 1.2 and 1.6)

Measured from the backend host during `docker build` unless stated otherwise:

| Source | Result |
|---|---|
| Docker Hub (`registry-1.docker.io`) | Not reachable from the backend host or from a second machine |
| `ghcr.io` with `docker pull` | Failed on the backend host (blob downloads retried, never finished) and on the second machine (the daemon uses the system proxy, EOF) |
| `deb.debian.org`, `files.pythonhosted.org` | About 0.01 MB/s, unusable |
| `mirrors.aliyun.com` (apt) | About 7.6 MB/s |
| `pypi.tuna.tsinghua.edu.cn` (Python packages) | About 7.3 MB/s |
| `registry.npmjs.org` | About 0.8 MB/s |
| `nodejs.org` | About 1.35 MB/s |
| Ubuntu package sources (spike 1.2) | Reachable; `apt-get update` 54 s, install 212 s |
| GitHub | Tarball 302 and `git ls-remote` work; large `git clone` is unreliable (connection resets), so sources are fetched on another machine and transferred |

Package sources are build arguments, not fixed in the Dockerfile, so another deployment can use the official sources.

## Integrity rules

Integrity comes from signatures and hashes, not from the transport, so a mirror cannot change what is installed:

- apt: package signatures are verified by apt.
- Python packages: hashes from `uv.lock`, enforced with `--require-hashes`.
- Node packages: `package-lock.json` integrity fields, enforced by `npm ci`.
- Node runtime: the tarball's SHA-256 is checked against the published checksum.
- Images: pinned by digest; every blob is checked by its sha256 during transfer, and after `docker load` the image ID must equal the pinned config digest.

## Image transfer

- Source registry: `ghcr.io` (the official linkding image is published there; values in [reference-target-linkding.md](reference-target-linkding.md), section "Version pin").
- Method that worked (task 1.3): on a machine with a direct connection, `scripts/fetch-oci.mjs` downloads the image by index digest into an OCI layout and checks every blob's sha256; `scripts/make-docker-load-manifest.mjs` adds the `manifest.json` that `docker load` needs; the directory is packed as a tar without macOS extended attributes; the tar is copied to the backend host; `docker load` loads it; the image ID equals the config digest.
- What did not work: `docker pull` on both machines; `docker load` of a plain OCI layout (it needs `manifest.json`); `docker load` of a macOS tar that carries extended attributes.
- The Development_Sandbox image is built locally on the backend host from the loaded base image with the package sources above.

## Public deployment

How to run the Studio as a public site. The files are in `deploy/` (see `deploy/README.md`); where a team hosts its own instance is not part of the product.

### Shape

- The backend runs on a host with a Docker engine (above) and listens on a private interface only.
- A front end serves the static web build and the published Replays and proxies `/api` to the backend on the same origin, so commands stay same-origin (R28.6) and the public link does not change when the backend moves (R32.7). `deploy/front/` holds an nginx image for this; `BACKEND_UPSTREAM` names the backend.
- TLS is terminated in front of the front end (a CDN or a TLS reverse proxy).
- Live execution (F4, F5 and F10) needs the backend host and its container engine; while the backend is down, the site shows "backend unreachable" and the published Replays still play (R27.13). A backend without a container engine runs with `GL_EXECUTION_ENABLED=false`; the home page then states that live execution is unavailable, and an Adapted_Repo Task ends in `failed` "not executed" at the pre-execution target check (R25.8).

### Requirements on the front end and anything in front of it

- SSE: `text/event-stream` responses are not buffered and not compressed, and idle connections of at least 60 s are allowed. The backend sends a visible `hb` event every 15 s; the client reconnects after 45 s without a frame and resumes with `Last-Event-ID` or `?last=` (R27.14).
- A down backend is answered with a JSON error (`503 {"error": ...}`) instead of an HTML page, so the web app can show it next to the input and in the banner. 503 is used because some CDNs replace an origin's 502 and 504 bodies with their own page.
- `/api/dev/` is refused (403); the development routes are for local work only.
- The front end sets `X-GL-Public: https` on proxied requests (the backend then sets `Secure` on the session cookie) and `X-Forwarded-For` to the visitor's address (the access-code back-off counts per address). Behind a CDN, nginx's real-IP setting must make `$remote_addr` the visitor.
- Caching: hashed build assets, Replay_Files and screenshots are immutable; `index.html` and `replays/index.json` are not cached. JSON, scripts and styles are compressed at the origin.
- Security headers on every response: a strict Content-Security-Policy (only same-origin scripts, styles, images and connections; no framing), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`. A script a CDN injects (for example an analytics beacon) is blocked by this policy.

### Operating a public instance

- Access codes (R28.7): `GL_ACCESS_CODES` on the backend; watching needs no code; each code may start `GL_ACCESS_CODE_DAILY_TASKS` Tasks per day. The codes for the Judges go into the submission's testing instructions.
- `GL_ADMIN_TOKEN` enables closing and opening the queue and an admin Sandbox restore.
- Automatic publishing (R27.15, `GL_PUBLISH_REPLAYS=1`): each exported Replay that passes the privacy check is added to `data/replays/published.json` on the backend and listed by `GET /api/replays`; the front end serves a Replay from its static folder when it is there and otherwise asks the backend, which answers requests marked `X-GL-Public` only for published Replays. Such a Replay plays only while the backend is up; copy it into the static folder with `scripts/replay-publish.ts` to keep it.
- Published Replays (17.6): `scripts/replay-publish.ts` checks each chosen Replay_File (the "Replay" label, secret patterns, local paths, private addresses and the values of an optional private-values file) and writes the set with its screenshots and `index.json` to a folder the front end serves at `/replays/`.
- Privacy rule (user, 2026-11-25): facts about a team's own hosting (host names and addresses, network setup, other services on the same machines) are not committed. The team's own instance is described only in its local, gitignored notes.

### Verified behaviour (2026-11-25, tasks 17.1 and 17.3)

- Through a CDN in front of the nginx front end: the first SSE frame arrives at once, the `hb` event arrives every 14 to 16 s without buffering, an idle stream stayed open for the full 11-minute test, and resume works with `Last-Event-ID` and with `?last=`. Live events arrived a median 0.44 s (at most 1.9 s) later than on a direct connection to the backend. The long-polling fallback is not needed.
- With the backend stopped, the banner appeared after 8.8 s and went away 27 s after the backend was started again; the published Replays kept playing.
- Compression at the origin cut a 1.5 MB Replay_File from 5 to 7 s to 1.5 to 1.9 s when the link between the origin and the CDN was slow.
