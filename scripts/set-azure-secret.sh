#!/usr/bin/env bash
#
# Store one CropCard secret in the resource group's Key Vault.
#
#   ./scripts/set-azure-secret.sh anthropic-api-key
#   ./scripts/set-azure-secret.sh pingram-api-key
#   ./scripts/set-azure-secret.sh pingram-webhook-secret       # from the Pingram webhook page
#   ./scripts/set-azure-secret.sh postmark-token
#   ./scripts/set-azure-secret.sh stripe-secret-key            # sk_live_… / rk_live_…
#   ./scripts/set-azure-secret.sh stripe-webhook-secret        # whsec_…
#   ./scripts/set-azure-secret.sh stripe-price-grower-monthly  # price_… (also -grower-annual, -farm-monthly, -farm-annual)
#   ./scripts/set-azure-secret.sh vapid-keys                   # generates and stores the Web Push pair
#   ./scripts/set-azure-secret.sh auth-secret --generate       # rotate: signs everyone out
#   ./scripts/set-azure-secret.sh push-tick-secret --generate
#
# The value is read from a hidden prompt (or stdin when piped) and streamed to
# Key Vault, so it never lands in shell history or a process argument list.
# vapid-keys runs apps/web/scripts/gen-vapid.mjs and refuses to replace an
# existing pair unless --rotate is given, since rotating ends every browser's
# push subscription. Re-run ./scripts/deploy-azure.sh --apply afterwards: newly
# present optional secrets are switched on, and a new revision picks up changed values.

set -euo pipefail

GROUP="${CROPCARD_GROUP:-cropcard-dev-rg}"
NAME="${1:-}"
usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
case "$NAME" in
  auth-secret|postmark-token|pingram-api-key|pingram-webhook-secret|anthropic-api-key|marketplace-seed-credential|push-tick-secret) ;;
  stripe-secret-key|stripe-webhook-secret) ;;
  stripe-price-grower-monthly|stripe-price-grower-annual|stripe-price-farm-monthly|stripe-price-farm-annual) ;;
  vapid-keys) ;;
  *) usage ;;
esac

KV="${CROPCARD_KV:-$(az keyvault list --resource-group "$GROUP" --query "[0].name" -o tsv)}"
[ -n "$KV" ] || { echo "No Key Vault in ${GROUP}; run ./scripts/deploy-azure.sh --apply first." >&2; exit 1; }

store() {
  printf '%s' "$2" | az keyvault secret set --vault-name "$KV" --name "$1" \
    --file /dev/stdin --output none
}

if [ "$NAME" = vapid-keys ]; then
  if az keyvault secret show --vault-name "$KV" --name vapid-private-key --query id -o tsv >/dev/null 2>&1 &&
    [ "${2:-}" != "--rotate" ]; then
    echo "${KV} already holds a VAPID pair; pass --rotate to replace it (every push subscription ends)." >&2
    exit 1
  fi
  command -v node >/dev/null || { echo "node is not installed" >&2; exit 1; }
  PAIR="$(node "$(dirname "$0")/../apps/web/scripts/gen-vapid.mjs" mailto:hello@cropcard.io)"
  PUB="$(printf '%s\n' "$PAIR" | sed -n 's/^VAPID_PUBLIC_KEY=//p')"
  PRIV="$(printf '%s\n' "$PAIR" | sed -n 's/^VAPID_PRIVATE_KEY=//p')"
  unset PAIR
  [ -n "$PUB" ] && [ -n "$PRIV" ] || { echo "gen-vapid.mjs printed no key pair" >&2; exit 1; }
  store vapid-private-key "$PRIV"
  store vapid-public-key "$PUB"
  unset PRIV PUB
  echo "stored vapid-public-key and vapid-private-key in ${KV}; now run ./scripts/deploy-azure.sh --apply"
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

case "$NAME" in
  stripe-secret-key) PATTERN='^(sk|rk)_(live|test)_[A-Za-z0-9]+$' ;;
  stripe-webhook-secret) PATTERN='^whsec_[A-Za-z0-9+/=]+$' ;;
  stripe-price-*) PATTERN='^price_[A-Za-z0-9]+$' ;;
  *) PATTERN='' ;;
esac
if [ -n "$PATTERN" ] && ! printf '%s' "$VALUE" | grep -Eq "$PATTERN"; then
  unset VALUE
  echo "that doesn't look like a ${NAME} value; nothing stored" >&2
  exit 1
fi

store "$NAME" "$VALUE"
unset VALUE
echo "stored ${NAME} in ${KV}; now run ./scripts/deploy-azure.sh --apply"
