# dev-sandbox image

`graftlab/dev-sandbox-<adapterId>`: the Adapter's pinned base image plus a generic layer. Used for the Development_Sandbox, the Run_Environment, the Verifier test container and the LLM_Proxy (design.md, "Images").

- `Dockerfile`: git, Node 24 (SHA-256 checked), the Adapter's dependency step, the pi packages, `runner.mjs` and `llm-proxy.mjs`.
- `runner/`: the Code_Agent runner (workspace `@graftlab/runner`), bundled to one file.
- `image/`: `package.json` and `package-lock.json` with only the runner's runtime dependencies (lock resolved against registry.npmjs.org; `npm ci` enforces the sha512 values even through a mirror).

## Build

1. On a machine with a reliable connection, assemble the context (it creates or reuses the Adapter's mirror and runs `git archive` of the pinned commit):

   ```sh
   npx tsx scripts/dev-sandbox-context.ts linkding
   # GL_MIRROR_SOURCE_LINKDING=<path or git bundle> creates the mirror from a local copy instead of the upstream
   ```

   Output: `data/build/dev-sandbox-linkding/` and `data/build/dev-sandbox-linkding.tar`.

2. On the deployment host, with the base image loaded (its image ID must equal the Adapter's `baseline.configDigest`; see reference-deployment.md, "Image transfer"):

   ```sh
   docker build -t graftlab/dev-sandbox-linkding:latest \
     --build-arg BASE_IMAGE=<local tag of the base image> \
     --build-arg EXTRA_PATH=<EXTRA_PATH from build-args.json> \
     --build-arg APT_MIRROR=... --build-arg PYPI_INDEX=... --build-arg NPM_REGISTRY=... --build-arg NODE_DIST=... \
     data/build/dev-sandbox-linkding
   ```

   The package sources are optional build arguments; without them the official sources are used.

Measured 2026-11-23 on the first deployment host: 1.11 GB; Node 24.22.3, Python 3.13.7, uv 0.8.13, pytest 9.0.3, Django 6.0.7; pi packages 168 MB; linkding `node_modules` 27 MB.
