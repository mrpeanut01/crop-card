#!/usr/bin/env bash
#
# Build, push and deploy CropCard to Azure Container Apps.
#
#   ./scripts/deploy-azure.sh             # what-if only: shows the plan, changes nothing
#   ./scripts/deploy-azure.sh --apply     # actually deploy
#
# Merges to main deploy automatically: .github/workflows/deploy.yml builds the
# image and runs this script with --ci --image <ref>, so the parameters and the
# live check below are the only deploy logic. Run it by hand to bootstrap a
# fresh resource group or to redeploy without a merge.
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
# The same SHA is baked into the image (BUILD_SHA) and served by /api/health as
# `version`; the deploy only counts as done once the live app reports it.
#
# Custom domain: the template hosts the DNS zone and a CNAME per hostname. Until
# the registrar delegates to the zone's name servers the app stays on its
# default hostname. Once public DNS resolves, the next deploy adds the
# hostnames and requests managed certificates; when those are issued this
# script deploys again to bind TLS and move ORIGIN to the first hostname. Every step is re-derived on each run.
#
# --ci (used by the workflow) expects the group, CROPCARD_ACR and CROPCARD_KV to
# exist, never creates or grants anything, and reads only secret names.
# --image <ref> deploys an already-pushed image instead of building one.

set -euo pipefail

GROUP="${CROPCARD_GROUP:-cropcard-dev-rg}"
LOCATION="${CROPCARD_LOCATION:-eastus2}"
APP_NAME="cropcard-dev-app"
DEPLOYMENT_NAME="main"
APPLY=false
ALLOW_DIRTY=false
CI_MODE=false
PREBUILT_IMAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    --ci) CI_MODE=true ;;
    --image) PREBUILT_IMAGE="${2:?--image needs a value}"; shift ;;
    -h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

command -v az >/dev/null || { echo "az is not installed" >&2; exit 1; }
az account get-access-token >/dev/null 2>&1 || { echo "Not signed in to Azure. Run: az login" >&2; exit 1; }

SHA="${CROPCARD_SHA:-$(git rev-parse HEAD)}"
TAG="${SHA::7}"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" = true ]; then
    TAG="${TAG}-dirty"
    SHA="${SHA}-dirty"
  else
    echo "Uncommitted changes; commit them or pass --allow-dirty." >&2
    exit 1
  fi
fi

echo "subscription : $(az account show --query name -o tsv)"
echo "group        : ${GROUP} (${LOCATION})"

if [ "$CI_MODE" = true ]; then
  [ -n "${CROPCARD_ACR:-}" ] && [ -n "${CROPCARD_KV:-}" ] ||
    { echo "--ci needs CROPCARD_ACR and CROPCARD_KV" >&2; exit 1; }
  az group show --name "$GROUP" --output none
else
  if [ "$APPLY" = false ] && ! az group show --name "$GROUP" >/dev/null 2>&1; then
    echo "Resource group does not exist yet; --apply will create it, a registry, and everything in infra/azure/main.bicep."
    exit 0
  fi
  az group create --name "$GROUP" --location "$LOCATION" --tags project=cropcard --output none
fi

ACR="${CROPCARD_ACR:-$(az acr list --resource-group "$GROUP" --query "[0].name" -o tsv 2>/dev/null || true)}"
if [ -z "$ACR" ]; then
  [ "$APPLY" = true ] || { echo "No registry yet; --apply will create one."; exit 0; }
  ACR="cropcardacr$(openssl rand -hex 4)"
  echo "creating registry ${ACR}"
  az acr create --resource-group "$GROUP" --name "$ACR" --location "$LOCATION" \
    --sku Basic --admin-enabled false --output none
fi
REGISTRY="${ACR}.azurecr.io"
IMAGE="${PREBUILT_IMAGE:-${REGISTRY}/cropcard-web:${TAG}}"
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

if [ "$CI_MODE" = false ]; then
  ME="$(az ad signed-in-user show --query id -o tsv)"
  if ! az role assignment list --assignee "$ME" --scope "$KV_ID" --role "Key Vault Secrets Officer" --query "[0].id" -o tsv | grep -q .; then
    az role assignment create --assignee-object-id "$ME" --assignee-principal-type User \
      --role "Key Vault Secrets Officer" --scope "$KV_ID" --output none
  fi
fi

# Only names are read (the CI identity is Key Vault Reader and can't see values).
# RBAC grants take a minute or two to reach the data plane.
for attempt in $(seq 1 12); do
  SECRET_NAMES="$(az keyvault secret list --vault-name "$KV" --query "[].name" -o tsv 2>/dev/null)" && break
  [ "$attempt" = 12 ] && { echo "no data-plane access to ${KV} after 2 minutes" >&2; exit 1; }
  sleep 10
done
kv_has() { printf '%s\n' "$SECRET_NAMES" | grep -qx "$1"; }

if ! kv_has auth-secret; then
  [ "$CI_MODE" = false ] || { echo "auth-secret missing from ${KV}; run this script locally with --apply once" >&2; exit 1; }
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

# ─── Custom domain readiness ────────────────────────────────────────────
# Zone and host labels come from the .bicepparam so the template and this
# check can't disagree.
PARAM_FILE="infra/azure/parameters.dev.bicepparam"
ZONE="$(sed -n "s/^param dnsZoneName = '\(.*\)'$/\1/p" "$PARAM_FILE")"
read -ra HOSTS <<<"$(sed -n "s/^param customHosts = \[\(.*\)\]$/\1/p" "$PARAM_FILE" | tr -d "',")"
FQDNS=(); for h in "${HOSTS[@]}"; do [ "$h" = "@" ] && FQDNS+=("$ZONE") || FQDNS+=("${h}.${ZONE}"); done
ENV_NAME="cropcard-dev-cae"
DNS_READY=false
if [ -n "$ZONE" ] && [ "${#FQDNS[@]}" -gt 0 ] && command -v dig >/dev/null; then
  STATIC_IP="$(az containerapp env show -g "$GROUP" -n "$ENV_NAME" --query properties.staticIp -o tsv 2>/dev/null || true)"
  APP_FQDN="$(az containerapp show -g "$GROUP" -n "$APP_NAME" --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || true)"
  VERIFY_ID="$(az containerapp show -g "$GROUP" -n "$APP_NAME" --query properties.customDomainVerificationId -o tsv 2>/dev/null || true)"
  if [ -n "$APP_FQDN" ] && [ -n "$VERIFY_ID" ]; then
    DNS_READY=true
    for f in "${FQDNS[@]}"; do
      if [ "$f" = "$ZONE" ]; then
        dig +short @1.1.1.1 A "$f" | grep -qx "$STATIC_IP"
      else
        dig +short @1.1.1.1 CNAME "$f" | grep -qx "${APP_FQDN}."
      fi &&
        dig +short @1.1.1.1 TXT "asuid.${f}" | tr -d '"' | grep -qx "$VERIFY_ID" ||
        DNS_READY=false
    done
  fi
fi
cert_issued() {
  [ "$DNS_READY" = true ] || return 1
  local issued
  issued="$(az containerapp env certificate list -g "$GROUP" -n "$ENV_NAME" --managed-certificates-only \
    --query "[?properties.provisioningState=='Succeeded'].name" -o tsv 2>/dev/null)" || return 1
  for f in "${FQDNS[@]}"; do
    printf '%s\n' "$issued" | grep -qx "cropcard-dev-${f//./-}" || return 1
  done
}
CERT_ISSUED=false; cert_issued && CERT_ISSUED=true
echo "domain       : ${FQDNS[*]:-none} (dns ready: ${DNS_READY}, certs issued: ${CERT_ISSUED})"

PARAMS=(
  --parameters "$PARAM_FILE"
  --parameters location="$LOCATION" image="$IMAGE" containerRegistryServer="$REGISTRY"
  --parameters keyVaultName="$KV" hasPingramKey="$HAS_PINGRAM" hasPostmarkToken="$HAS_POSTMARK" hasAnthropicKey="$HAS_ANTHROPIC"
)
[ -n "${EMAIL_FROM:-}" ] && PARAMS+=(--parameters emailFrom="$EMAIL_FROM")
domain_params() { echo "customDomainDnsReady=$DNS_READY" "customDomainCertIssued=$CERT_ISSUED"; }

if [ "$APPLY" = false ]; then
  az deployment group what-if -g "$GROUP" --name "$DEPLOYMENT_NAME" \
    --template-file infra/azure/main.bicep "${PARAMS[@]}" --parameters $(domain_params)
  exit 0
fi

if [ -n "$PREBUILT_IMAGE" ]; then
  echo "using prebuilt image"
elif az acr repository show-tags --name "$ACR" --repository cropcard-web -o tsv 2>/dev/null | grep -qx "$TAG"; then
  echo "image ${TAG} already in registry, skipping build"
else
  # Built locally: the Dockerfile uses BuildKit cache mounts, which `az acr build` doesn't support.
  command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
  az acr login --name "$ACR" --output none
  docker buildx build --platform linux/amd64 --file infra/Dockerfile --target runtime \
    --build-arg BUILD_SHA="$SHA" --tag "$IMAGE" --push .
fi

deploy() {
  az deployment group create -g "$GROUP" --name "$DEPLOYMENT_NAME" \
    --template-file infra/azure/main.bicep "${PARAMS[@]}" --parameters $(domain_params) --output none
}
deploy

# First deploy with DNS ready requested the certificate; bind it once issued.
if [ "$DNS_READY" = true ] && [ "$CERT_ISSUED" = false ]; then
  for i in $(seq 1 40); do
    cert_issued && { CERT_ISSUED=true; break; }
    echo "waiting for the ${FQDNS[*]} certificates [$i/40]"
    sleep 15
  done
  if [ "$CERT_ISSUED" = true ]; then
    echo "binding TLS for ${FQDNS[*]}"
    deploy
  else
    echo "certificates for ${FQDNS[*]} not issued yet; the next deploy binds them" >&2
  fi
fi

NS="$(az deployment group show -g "$GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.customDomainNameServers.value" -o tsv 2>/dev/null | tr '\n' ' ')"
if [ -n "$ZONE" ] && [ "$DNS_READY" = false ]; then
  echo "domain       : ${ZONE} is not delegated yet; set its name servers at the registrar to: ${NS}"
fi

ORIGIN="$(az deployment group show -g "$GROUP" --name "$DEPLOYMENT_NAME" --query properties.outputs.appOrigin.value -o tsv)"
echo "deployed     : ${ORIGIN}"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "origin=${ORIGIN}" >> "$GITHUB_OUTPUT"

# Load the app once the way a browser would, so the first real visitor doesn't
# pay for SSR module loading and cold asset fetches. Best effort: a failure
# here never fails the deploy.
warm_up() {
  local page assets fonts path n=0
  page="$(curl -fsS -i --max-time 60 "${ORIGIN}/" 2>/dev/null || true)"
  if [ -z "$page" ]; then
    echo "warm-up      : landing page did not answer (skipped)"
    return 0
  fi
  # The HTML and its Link preload header reference assets as ./_app/... or /...
  assets="$(printf '%s' "$page" |
    grep -oE '(href="|src="|import\("|<)\.?/[^/"#>][^"#>]*' |
    sed -E 's/^(href="|src="|import\("|<)\.?//' | sort -u || true)"
  for path in /manifest.webmanifest /registerSW.js /sw.js $assets; do
    curl -fsS --max-time 30 -o /dev/null "${ORIGIN}${path}" 2>/dev/null && n=$((n + 1))
  done
  # Fonts are only named inside the stylesheets.
  fonts="$(for path in $(printf '%s\n' $assets | grep '\.css$'); do
      curl -fsS --max-time 30 "${ORIGIN}${path}" 2>/dev/null || true
    done | grep -oE 'url\([^)]*fonts/[^)]+\)' | grep -oE '/fonts/[^)"'"'"']+' | sort -u || true)"
  for path in $fonts; do
    curl -fsS --max-time 30 -o /dev/null "${ORIGIN}${path}" 2>/dev/null && n=$((n + 1))
  done
  echo "warm-up      : loaded / and ${n} assets"
}

# The ARM deployment returns before the new revision takes traffic. Done means
# the live app reports this build's SHA, not merely that something answers.
LIVE=""
for i in $(seq 1 40); do
  LIVE="$(curl -fsS --max-time 30 "${ORIGIN}/api/health" 2>/dev/null |
    sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
  if [ "$LIVE" = "$SHA" ]; then
    echo "live         : ${SHA} at ${ORIGIN}"
    warm_up
    exit 0
  fi
  echo "waiting for ${SHA::7} (serving: ${LIVE:-no answer}) [$i/40]"
  sleep 15
done
echo "the new build never went live (still serving: ${LIVE:-no answer}); see: az containerapp logs show -g $GROUP -n $APP_NAME --tail 100" >&2
exit 1
