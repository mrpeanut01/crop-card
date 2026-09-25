#!/usr/bin/env bash
#
# One-time setup so .github/workflows/deploy.yml can deploy main to Azure.
# Idempotent; run it after scripts/deploy-azure.sh --apply has created the
# resource group, registry and Key Vault. Needs `az login` (Owner on the
# resource group) and `gh auth login` (admin on the repo).
#
# Creates the `cropcard-github-deploy` Entra app, trusted only for GitHub OIDC
# tokens from this repo's `production` environment, which only main can deploy
# to. Its roles are confined to the resource group:
#   Contributor                          on the resource group
#   AcrPush                              on the registry
#   Key Vault Reader                     on the vault (secret names, never values)
#   Role Based Access Control Administrator on the resource group, conditioned
#     so it can only grant or remove AcrPull and Key Vault Secrets User — the
#     two roles main.bicep assigns to the app identity.

set -euo pipefail

REPO="${CROPCARD_REPO:-mrpeanut01/crop-card}"
GROUP="${CROPCARD_GROUP:-cropcard-dev-rg}"
APP_NAME="cropcard-github-deploy"
ACRPULL=7f951dda-4ed3-4680-a7ca-43fe172d538d
KV_SECRETS_USER=4633458b-17de-408a-b874-0445c86b69e6

SUB="$(az account show --query id -o tsv)"
TENANT="$(az account show --query tenantId -o tsv)"
RG_ID="$(az group show -n "$GROUP" --query id -o tsv)"
ACR="$(az acr list -g "$GROUP" --query "[0].name" -o tsv)"
KV="$(az keyvault list -g "$GROUP" --query "[0].name" -o tsv)"
[ -n "$ACR" ] && [ -n "$KV" ] || { echo "Run ./scripts/deploy-azure.sh --apply first." >&2; exit 1; }
ACR_ID="$(az acr show -n "$ACR" --query id -o tsv)"
KV_ID="$(az keyvault show -n "$KV" --query id -o tsv)"

APP_ID="$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)"
[ -n "$APP_ID" ] || APP_ID="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" --output none
SP="$(az ad sp show --id "$APP_ID" --query id -o tsv)"

SUBJECT="repo:${REPO}:environment:production"
if ! az ad app federated-credential list --id "$APP_ID" --query "[].subject" -o tsv | grep -qx "$SUBJECT"; then
  az ad app federated-credential create --id "$APP_ID" --output none --parameters "{
    \"name\": \"github-production\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"${SUBJECT}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"
fi

assign() { # role scope [condition]
  if az role assignment list --assignee "$SP" --role "$1" --scope "$2" --query "[0].id" -o tsv | grep -q .; then
    echo "has    : $1"
    return
  fi
  local extra=()
  [ -n "${3:-}" ] && extra=(--condition "$3" --condition-version 2.0)
  az role assignment create --assignee-object-id "$SP" --assignee-principal-type ServicePrincipal \
    --role "$1" --scope "$2" "${extra[@]}" --output none
  echo "granted: $1"
}

assign Contributor "$RG_ID"
assign AcrPush "$ACR_ID"
assign "Key Vault Reader" "$KV_ID"
COND="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${ACRPULL}, ${KV_SECRETS_USER}})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${ACRPULL}, ${KV_SECRETS_USER}}))"
assign "Role Based Access Control Administrator" "$RG_ID" "$COND"

# GitHub: a `production` environment only main can deploy to, plus the
# identifiers the workflow reads. None of these are secrets.
gh api -X PUT "repos/${REPO}/environments/production" --silent --input - <<EOF
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
EOF
if ! gh api "repos/${REPO}/environments/production/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main; then
  gh api -X POST "repos/${REPO}/environments/production/deployment-branch-policies" \
    -f name=main -f type=branch --silent
fi

gh variable set AZURE_CLIENT_ID --repo "$REPO" --body "$APP_ID"
gh variable set AZURE_TENANT_ID --repo "$REPO" --body "$TENANT"
gh variable set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUB"
gh variable set AZURE_RESOURCE_GROUP --repo "$REPO" --body "$GROUP"
gh variable set ACR_NAME --repo "$REPO" --body "$ACR"
gh variable set KEY_VAULT_NAME --repo "$REPO" --body "$KV"

echo
echo "Done. Merges to main now deploy after ci passes; run manually with:"
echo "  gh workflow run deploy --repo ${REPO} --ref main"
