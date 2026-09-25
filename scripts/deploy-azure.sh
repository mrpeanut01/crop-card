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
#   POSTMARK_TOKEN      + EMAIL_FROM          enables emailed magic links (else they go to the log)
#   ANTHROPIC_API_KEY                         enables AI assists (else no-key mode)
#   AUTH_SECRET                               only on first deploy; later deploys reuse the live one
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
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# The signing secret is read back from the running app so re-deploys don't sign everyone out.
SECRET="${AUTH_SECRET:-$(az containerapp secret show -g "$GROUP" -n "$APP_NAME" --secret-name auth-secret --query value -o tsv 2>/dev/null || true)}"
if [ -z "$SECRET" ]; then
  SECRET="$(openssl rand -base64 32)"
  echo "generated a new AUTH_SECRET (stored only as a Container App secret)"
fi

PARAMS=(
  --parameters infra/azure/parameters.dev.bicepparam
  --parameters location="$LOCATION" image="$IMAGE" containerRegistryServer="$REGISTRY"
  --parameters authSecret="$SECRET"
)
[ -n "${POSTMARK_TOKEN:-}" ] && PARAMS+=(--parameters postmarkToken="$POSTMARK_TOKEN")
[ -n "${EMAIL_FROM:-}" ] && PARAMS+=(--parameters emailFrom="$EMAIL_FROM")
[ -n "${ANTHROPIC_API_KEY:-}" ] && PARAMS+=(--parameters anthropicApiKey="$ANTHROPIC_API_KEY")

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
