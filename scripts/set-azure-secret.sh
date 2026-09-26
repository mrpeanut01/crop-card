#!/usr/bin/env bash
#
# Store one CropCard secret in the resource group's Key Vault.
#
#   ./scripts/set-azure-secret.sh anthropic-api-key
#   ./scripts/set-azure-secret.sh postmark-token
#   ./scripts/set-azure-secret.sh pingram-api-key
#   ./scripts/set-azure-secret.sh auth-secret --generate   # rotate: signs everyone out
#   ./scripts/set-azure-secret.sh push-tick-secret --generate
#   ./scripts/set-azure-secret.sh vapid --generate [--force]
#
# The value is read from a hidden prompt (or stdin when piped) and streamed to
# Key Vault, so it never lands in shell history or a process argument list.
# `vapid` generates a Web Push key pair in-process (apps/web/scripts/gen-vapid.mjs)
# and stores vapid-public-key + vapid-private-key; the private key is never
# printed or written to disk. An existing pair is kept unless --force: rotating
# it breaks every browser's push subscription until each user re-subscribes.
# Re-run ./scripts/deploy-azure.sh --apply afterwards: newly present optional
# secrets are switched on, and a new revision picks up changed values.

set -euo pipefail

GROUP="${CROPCARD_GROUP:-cropcard-dev-rg}"
NAME="${1:-}"
case "$NAME" in
  auth-secret|postmark-token|pingram-api-key|anthropic-api-key|marketplace-seed-credential|push-tick-secret) ;;
  vapid) [ "${2:-}" = "--generate" ] || { echo "usage: $0 vapid --generate [--force]" >&2; exit 2; } ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

KV="${CROPCARD_KV:-$(az keyvault list --resource-group "$GROUP" --query "[0].name" -o tsv)}"
[ -n "$KV" ] || { echo "No Key Vault in ${GROUP}; run ./scripts/deploy-azure.sh --apply first." >&2; exit 1; }

if [ "$NAME" = "vapid" ]; then
  EXISTING="$(az keyvault secret list --vault-name "$KV" --query "[].name" -o tsv)"
  if printf '%s\n' "$EXISTING" | grep -qxE 'vapid-(public|private)-key' && [ "${3:-}" != "--force" ]; then
    echo "a VAPID key already exists in ${KV}; kept." >&2
    echo "Rotating it breaks every browser push subscription (each user must turn" >&2
    echo "notifications on again). Re-run with --force to rotate anyway." >&2
    exit 1
  fi
  GEN="$(dirname "$0")/../apps/web/scripts/gen-vapid.mjs"
  { IFS= read -r PUB && IFS= read -r PRIV; } < <(node "$GEN" --raw)
  { [ "${#PUB}" -eq 87 ] && [ "${#PRIV}" -eq 43 ]; } || { echo "key generation failed; nothing stored" >&2; exit 1; }
  printf '%s' "$PRIV" | az keyvault secret set --vault-name "$KV" --name vapid-private-key \
    --file /dev/stdin --content-type "Web Push VAPID private key (base64url P-256 scalar)" --output none
  unset PRIV
  printf '%s' "$PUB" | az keyvault secret set --vault-name "$KV" --name vapid-public-key \
    --file /dev/stdin --content-type "Web Push VAPID public key (base64url P-256 point)" --output none
  unset PUB
  echo "stored vapid-public-key + vapid-private-key in ${KV}; now run ./scripts/deploy-azure.sh --apply"
  exit 0
fi

if [ "${2:-}" = "--generate" ]; then
  VALUE="$(openssl rand -base64 32 | tr -d '\n')"
elif [ -t 0 ]; then
  read -r -s -p "${NAME}: " VALUE; echo
else
  IFS= read -r VALUE
fi
[ -n "$VALUE" ] || { echo "empty value; nothing stored" >&2; exit 1; }

printf '%s' "$VALUE" | az keyvault secret set --vault-name "$KV" --name "$NAME" \
  --file /dev/stdin --output none
unset VALUE
echo "stored ${NAME} in ${KV}; now run ./scripts/deploy-azure.sh --apply"
