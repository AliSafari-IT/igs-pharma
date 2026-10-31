#!/usr/bin/env bash
# D-023: a final image must not mention build/runtime secrets in its history or its ENV.
# Usage: tools/ci/check-image-secrets.sh <image-reference>
#
# Limits: it matches variable NAMES only (a baked secret VALUE with no name next to it passes). The
# list below is kept by hand, but it is checked: packages/config/src/env-sensitivity.ts classifies
# EVERY variable of env.ts as sensitive or not, and its test (env-sensitivity.test.ts) fails when a
# variable is unclassified or when a sensitive name is missing from the list below. Extra names are
# fine (the CI-only ones, and AUTH_URL, which no image should carry either).
set -euo pipefail
image="${1:?usage: check-image-secrets.sh <image>}"
# Every `sensitive` variable of packages/config/src/env-sensitivity.ts, plus the CI-only ones.
names='AUTH_SECRET|DATABASE_URL|DATABASE_MIGRATE_URL|AUTH_URL|AUDIT_HMAC_KEY|ENCRYPTION_KEY|KMS_KEY_ID|SENTRY_DSN|SMTP_URL|MOLLIE_API_KEY|TURBO_TOKEN|TURBO_TEAM'

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
