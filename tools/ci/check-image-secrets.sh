#!/usr/bin/env bash
# D-023: a final image must not mention build/runtime secrets in its history or its ENV.
# Usage: tools/ci/check-image-secrets.sh <image-reference>
set -euo pipefail
image="${1:?usage: check-image-secrets.sh <image>}"
# Names of every secret-like variable the apps, the worker and CI use (packages/config/src/env.ts).
names='AUTH_SECRET|DATABASE_URL|AUTH_URL|AUDIT_HMAC_KEY|IGS_PREVIEW_KEY|ENCRYPTION_KEY|KMS_KEY_ID|TURBO_TOKEN|TURBO_TEAM'
if docker history --no-trunc "$image" | grep -Eq "$names"; then
  echo "::error::final image history mentions build/runtime secrets"
  exit 1
fi
if docker image inspect "$image" --format '{{json .Config.Env}}' | grep -Eq "$names"; then
  echo "::error::final image ENV contains secrets"
  exit 1
fi
echo "no secret names in the history or ENV of $image"
