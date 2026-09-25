#!/usr/bin/env bash
#
# Store one CropCard secret in the resource group's Key Vault.
#
#   ./scripts/set-azure-secret.sh anthropic-api-key
#   ./scripts/set-azure-secret.sh postmark-token
#   ./scripts/set-azure-secret.sh auth-secret --generate   # rotate: signs everyone out
#
# The value is read from a hidden prompt (or stdin when piped) and streamed to
# Key Vault, so it never lands in shell history or a process argument list.
# Re-run ./scripts/deploy-azure.sh --apply afterwards: newly present optional
# secrets are switched on, and a new revision picks up changed values.

set -euo pipefail

GROUP="${CROPCARD_GROUP:-cropcard-dev-rg}"
NAME="${1:-}"
case "$NAME" in
  auth-secret|postmark-token|anthropic-api-key|marketplace-seed-credential) ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

KV="${CROPCARD_KV:-$(az keyvault list --resource-group "$GROUP" --query "[0].name" -o tsv)}"
[ -n "$KV" ] || { echo "No Key Vault in ${GROUP}; run ./scripts/deploy-azure.sh --apply first." >&2; exit 1; }

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
