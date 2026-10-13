#!/usr/bin/env bash
# D-023: a final image must not mention build/runtime secrets in its history or its ENV.
# Usage: tools/ci/check-image-secrets.sh <image-reference>
#
# Limits: it matches variable NAMES only (a baked secret VALUE with no name next to it passes), and
# the list below is maintained by hand next to packages/config/src/env.ts (deriving it from the env
# schema would be a follow-up).
set -euo pipefail
image="${1:?usage: check-image-secrets.sh <image>}"
# Names of every secret-like variable the apps, the worker and CI use (packages/config/src/env.ts).
names='AUTH_SECRET|DATABASE_URL|AUTH_URL|AUDIT_HMAC_KEY|IGS_PREVIEW_KEY|ENCRYPTION_KEY|KMS_KEY_ID|TURBO_TOKEN|TURBO_TEAM'

# Capture first, then grep: `docker ... | grep -q` under pipefail can exit 141 (SIGPIPE) when grep
# matches early, and an `if` would read that as "no match", i.e. pass while the secret is present.
history=$(docker history --no-trunc "$image")
if grep -Eq "$names" <<<"$history"; then
  echo "::error::final image history mentions build/runtime secrets"
  exit 1
fi
env_json=$(docker image inspect "$image" --format '{{json .Config.Env}}')
if grep -Eq "$names" <<<"$env_json"; then
  echo "::error::final image ENV contains secrets"
  exit 1
fi
echo "no secret names in the history or ENV of $image"
