#!/usr/bin/env bash
#
# Build, push and deploy CropCard to Azure Container Apps.
#
#   ./scripts/deploy-azure.sh             # what-if only: shows the plan, changes nothing
#   ./scripts/deploy-azure.sh --apply     # actually deploy
#
# Needs `az login`. Optional environment:
#   CROPCARD_GROUP      resource group        (default cropcard-dev-rg)
#   CROPCARD_LOCATION   region                (default eastus2)
#   CROPCARD_ACR        registry name         (default: discovered in the group, else created)
#   CROPCARD_KV         Key Vault name        (default: discovered in the group, else created)
#   EMAIL_FROM                                sender address (Postmark / Pingram)
#
# Secrets live only in the Key Vault; this script never passes one to the template.
# The session secret is generated there on first deploy. Optional secrets are
# switched on by their presence in the vault:
#   pingram-api-key     email + SMS sign-in codes via Pingram (email wins over postmark-token)
#   postmark-token      emailed magic links (else they go to the container log)
#   anthropic-api-key   AI assists (else no-key mode)
# Set one with:  ./scripts/set-azure-secret.sh anthropic-api-key
#
# The image tag is the commit SHA, so a dirty tree is refused unless --allow-dirty.

set -euo pipefail

GROUP="${CROPCARD_GROUP:-cropcard-dev-rg}"
LOCATION="${CROPCARD_LOCATION:-eastus2}"
APP_NAME="cropcard-dev-app"
DEPLOYMENT_NAME="main"
APPLY=false
ALLOW_DIRTY=false

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

command -v az >/dev/null || { echo "az is not installed" >&2; exit 1; }
az account get-access-token >/dev/null 2>&1 || { echo "Not signed in to Azure. Run: az login" >&2; exit 1; }

TAG="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" = true ]; then
    TAG="${TAG}-dirty"
  else
    echo "Uncommitted changes; commit them or pass --allow-dirty." >&2
    exit 1
  fi
fi

echo "subscription : $(az account show --query name -o tsv)"
echo "group        : ${GROUP} (${LOCATION})"

if [ "$APPLY" = false ]; then
  if ! az group show --name "$GROUP" >/dev/null 2>&1; then
    echo "Resource group does not exist yet; --apply will create it, a registry, and everything in infra/azure/main.bicep."
    exit 0
  fi
fi

az group create --name "$GROUP" --location "$LOCATION" --tags project=cropcard --output none

ACR="${CROPCARD_ACR:-$(az acr list --resource-group "$GROUP" --query "[0].name" -o tsv 2>/dev/null || true)}"
if [ -z "$ACR" ]; then
  [ "$APPLY" = true ] || { echo "No registry yet; --apply will create one."; exit 0; }
  ACR="cropcardacr$(openssl rand -hex 4)"
  echo "creating registry ${ACR}"
  az acr create --resource-group "$GROUP" --name "$ACR" --location "$LOCATION" \
    --sku Basic --admin-enabled false --output none
fi
REGISTRY="${ACR}.azurecr.io"
IMAGE="${REGISTRY}/cropcard-web:${TAG}"
echo "image        : ${IMAGE}"

# ─── Key Vault ──────────────────────────────────────────────────────────
# Created here rather than in the template so auth-secret can be seeded before
# the Container App that references it exists. RBAC mode, purge-protected.
KV="${CROPCARD_KV:-$(az keyvault list --resource-group "$GROUP" --query "[0].name" -o tsv 2>/dev/null || true)}"
if [ -z "$KV" ]; then
  [ "$APPLY" = true ] || { echo "No Key Vault yet; --apply will create one."; exit 0; }
  KV="cropcard-kv-$(openssl rand -hex 4)"
  echo "creating key vault ${KV}"
  az keyvault create --resource-group "$GROUP" --name "$KV" --location "$LOCATION" \
    --enable-rbac-authorization true --enable-purge-protection true \
    --retention-days 90 --tags project=cropcard --output none
fi
KV_ID="$(az keyvault show --name "$KV" --query id -o tsv)"
echo "key vault    : ${KV}"

ME="$(az ad signed-in-user show --query id -o tsv)"
if ! az role assignment list --assignee "$ME" --scope "$KV_ID" --role "Key Vault Secrets Officer" --query "[0].id" -o tsv | grep -q .; then
  az role assignment create --assignee-object-id "$ME" --assignee-principal-type User \
    --role "Key Vault Secrets Officer" --scope "$KV_ID" --output none
fi

kv_has() { az keyvault secret show --vault-name "$KV" --name "$1" --query id -o tsv >/dev/null 2>&1; }

# RBAC grants take a minute or two to reach the data plane.
for attempt in $(seq 1 12); do
  az keyvault secret list --vault-name "$KV" --query "[0].id" -o tsv >/dev/null 2>&1 && break
  [ "$attempt" = 12 ] && { echo "no data-plane access to ${KV} after 2 minutes" >&2; exit 1; }
  sleep 10
done

if ! kv_has auth-secret; then
  [ "$APPLY" = true ] || { echo "auth-secret not in vault yet; --apply will seed it."; exit 0; }
  # Carry over a secret already held by the running app so nobody is signed out.
  LEGACY="$(az containerapp secret show -g "$GROUP" -n "$APP_NAME" --secret-name auth-secret --query value -o tsv 2>/dev/null || true)"
  { [ -n "$LEGACY" ] && printf '%s' "$LEGACY" || openssl rand -base64 32 | tr -d '\n'; } |
    az keyvault secret set --vault-name "$KV" --name auth-secret --file /dev/stdin \
      --content-type "HMAC session signing secret" --output none
  unset LEGACY
  echo "seeded auth-secret in ${KV}"
fi

HAS_PINGRAM=false; kv_has pingram-api-key && HAS_PINGRAM=true
HAS_POSTMARK=false; kv_has postmark-token && HAS_POSTMARK=true
HAS_ANTHROPIC=false; kv_has anthropic-api-key && HAS_ANTHROPIC=true
echo "pingram      : ${HAS_PINGRAM}"
echo "postmark     : ${HAS_POSTMARK}"
echo "anthropic    : ${HAS_ANTHROPIC}"

PARAMS=(
  --parameters infra/azure/parameters.dev.bicepparam
  --parameters location="$LOCATION" image="$IMAGE" containerRegistryServer="$REGISTRY"
  --parameters keyVaultName="$KV" hasPingramKey="$HAS_PINGRAM" hasPostmarkToken="$HAS_POSTMARK" hasAnthropicKey="$HAS_ANTHROPIC"
)
[ -n "${EMAIL_FROM:-}" ] && PARAMS+=(--parameters emailFrom="$EMAIL_FROM")

if [ "$APPLY" = false ]; then
  az deployment group what-if -g "$GROUP" --name "$DEPLOYMENT_NAME" \
    --template-file infra/azure/main.bicep "${PARAMS[@]}"
  exit 0
fi

if az acr repository show-tags --name "$ACR" --repository cropcard-web -o tsv 2>/dev/null | grep -qx "$TAG"; then
  echo "image ${TAG} already in registry, skipping build"
else
  # Built locally: the Dockerfile uses BuildKit cache mounts, which `az acr build` doesn't support.
  command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
  az acr login --name "$ACR" --output none
  docker buildx build --platform linux/amd64 --file infra/Dockerfile --target runtime \
    --tag "$IMAGE" --push .
fi

az deployment group create -g "$GROUP" --name "$DEPLOYMENT_NAME" \
  --template-file infra/azure/main.bicep "${PARAMS[@]}" --output none

ORIGIN="$(az deployment group show -g "$GROUP" --name "$DEPLOYMENT_NAME" --query properties.outputs.appOrigin.value -o tsv)"
echo "deployed     : ${ORIGIN}"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 60 "${ORIGIN}/api/health"; then echo; echo "health OK"; exit 0; fi
  echo "health attempt $i failed; retrying"
  sleep 10
done
echo "health check failed; see: az containerapp logs show -g $GROUP -n $APP_NAME --tail 100" >&2
exit 1
