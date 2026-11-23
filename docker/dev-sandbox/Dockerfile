# Development_Sandbox image `graftlab/dev-sandbox-<adapterId>` (design: Images; R39.2, R25.6).
# Built from a context assembled by `scripts/dev-sandbox-context.mjs`:
#   adapter/setup.sh   the Adapter's dependency step (toolchain and preinstalled dependencies of the UNMODIFIED pinned source)
#   target-src/        `git archive` of the pinned commit from the Adapter's mirror
#   runner/            package.json and package-lock.json of the pi packages, runner.mjs, llm-proxy.mjs
# Package sources are build arguments; integrity comes from apt signatures, the Node SHA-256, lock-file hashes
# (`--require-hashes`, `npm ci`), never from the transport, so a mirror cannot change what is installed.
# Nothing here starts the target: no start recipe for the modified target is part of the image (R39.10).
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
ENV DEBIAN_FRONTEND=noninteractive

ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i -e "s#http://deb.debian.org/debian-security#${APT_MIRROR}/debian-security#g" \
             -e "s#http://deb.debian.org/debian#${APT_MIRROR}/debian#g" /etc/apt/sources.list.d/debian.sources; \
    fi \
 && apt-get update && apt-get install -y --no-install-recommends git xz-utils ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Node 24 LTS, checksum verified (the value is the published SHA-256 of the linux-x64 tarball).
ARG NODE_DIST=https://nodejs.org/dist
ARG NODE_VERSION=24.22.3
ARG NODE_SHA256=4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb
RUN curl -fsSL -o /tmp/node.tar.xz "${NODE_DIST}/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 && rm /tmp/node.tar.xz
ENV PATH=/opt/node/bin:$PATH

# Adapter part: dependencies of the pinned source, prebuilt in /opt/target-src.
ARG PYPI_INDEX=https://pypi.org/simple
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY target-src/ /opt/target-src/
COPY adapter/setup.sh /opt/adapter/setup.sh
RUN cd /opt/target-src && PYPI_INDEX="$PYPI_INDEX" NPM_REGISTRY="$NPM_REGISTRY" sh /opt/adapter/setup.sh
# The Adapter's devSandbox.path entries and Node, in front of the base image's PATH (set by the context script).
ARG EXTRA_PATH=/opt/node/bin
ENV PATH=${EXTRA_PATH}:${PATH}

# Generic part: the pi packages (lock file resolved against registry.npmjs.org, sha512 enforced by npm ci) and our bundles.
COPY runner/package.json runner/package-lock.json /opt/runner/
RUN cd /opt/runner && npm ci --omit=dev --no-audit --no-fund --registry="$NPM_REGISTRY" && rm -rf /root/.npm
COPY runner/runner.mjs runner/llm-proxy.mjs /opt/runner/

WORKDIR /work
