#!/bin/sh
# linkding part of the Development_Sandbox image (reference-target-linkding.md, "Development_Sandbox for linkding").
# Runs in /opt/target-src (the pinned, unmodified source). Installs the dev dependency group into the image's
# existing venv with hash checking, then `npm ci` and `npm run build`, so tests and the frontend build work offline.
# It never starts linkding.
set -eu
: "${PYPI_INDEX:?}" "${NPM_REGISTRY:?}"

# uv 0.8.13, hash-pinned wheel (manylinux x86_64).
printf 'uv==0.8.13 --hash=sha256:2113cd877974b68ea2af64a2f2cc23708ba97066046e78efb72ba94e5fef617a\n' > /tmp/uv-req.txt
/usr/local/bin/python3.13 -m pip install --no-cache-dir --require-hashes --index-url "$PYPI_INDEX" -r /tmp/uv-req.txt

# Dev dependency group from uv.lock, installed with the hashes from the lock file.
uv export --frozen --no-emit-project --only-group dev --format requirements-txt -o /tmp/dev-req.txt
uv pip install --python /etc/linkding/.venv/bin/python --require-hashes --index-url "$PYPI_INDEX" -r /tmp/dev-req.txt
echo "dev dependencies installed: $(grep -c '==' /tmp/dev-req.txt)"

npm ci --no-audit --no-fund --registry="$NPM_REGISTRY"
npm run build
rm -rf /root/.npm /root/.cache /tmp/uv-req.txt /tmp/dev-req.txt
