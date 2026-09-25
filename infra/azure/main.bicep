// CropCard — Azure Container Apps deployment.
//
// Cheap, single-replica, scale-to-zero. Single-writer SQLite + Litestream → Blob.
// Everything lives in its own resource group; nothing is shared with other apps
// in the subscription.
//
// The container registry is created by scripts/deploy-azure.sh before this runs
// (the app needs an image to pull at creation time). This template grants the
// app's identity AcrPull on it.

@description('Project tag, also used as a name prefix.')
param project string = 'cropcard'

@description('Environment short name (dev | prod).')
param env string = 'dev'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image reference for the web app, e.g. cropcardacr.azurecr.io/cropcard-web:abc1234.')
param image string

@description('Login server of an ACR in this resource group, e.g. cropcardacr.azurecr.io. Empty = public image, no registry auth.')
param containerRegistryServer string = ''

@description('Name of the Key Vault (created by scripts/deploy-azure.sh) holding the app secrets.')
param keyVaultName string

@description('UC-17 sign-in mode. magic-link disables the direct/demo sign-in.')
@allowed(['magic-link', 'direct'])
param authMode string = 'magic-link'

@description('Key Vault holds a postmark-token secret. False = magic links and invites are written to the container log instead of emailed.')
param hasPostmarkToken bool = false

@description('From-address for outbound email (Postmark sender signature).')
param emailFrom string = ''

@description('Key Vault holds an anthropic-api-key secret. False = no-key mode (Invariant 7: deterministic fallbacks).')
param hasAnthropicKey bool = false

@description('Deploy the plugin marketplace app (with its ClamAV sidecar). The web app does not depend on it.')
param deployMarketplace bool = false

@description('Container image reference for the marketplace.')
param marketplaceImage string = image

@description('Comma-separated list of operator emails allowed to sign in to the marketplace admin UI.')
param marketplaceAdminEmails string = ''

@description('Key Vault holds a marketplace-seed-credential secret (format ccm_<base64url>).')
param hasMarketplaceSeed bool = false

// Names
var prefix = '${project}-${env}'
var storageName = toLower(replace('${prefix}stg', '-', ''))
var logsName = '${prefix}-logs'
var envName = '${prefix}-cae'
var appName = '${prefix}-app'
var identityName = '${prefix}-id'
var marketplaceAppName = '${prefix}-marketplace'
var blobContainerName = 'cropcard'
var marketplaceBlobContainerName = 'cropcard-marketplace'
var useRegistry = !empty(containerRegistryServer)
var acrName = useRegistry ? split(containerRegistryServer, '.')[0] : 'none'
var kvSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

// ─── Storage account + blob container for Litestream replicas ──────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Cool'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource blobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
}

// Separate blob container so the two apps' WAL frames can't collide.
resource marketplaceBlobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (deployMarketplace) {
  parent: blobService
  name: marketplaceBlobContainerName
}

// ─── Log Analytics workspace (required by ACA) ─────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ─── Registry pull identity ────────────────────────────────────────────
// User-assigned so the AcrPull grant exists before the Container App is
// created; a system-assigned identity can't be granted until the app exists,
// and the app can't be created until it can pull.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = if (useRegistry) {
  name: acrName
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useRegistry) {
  name: guid(resourceGroup().id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}

// ─── Key Vault secrets ─────────────────────────────────────────────────
// The vault is created (and auth-secret seeded) by the deploy script so the
// session secret never passes through a template parameter. The storage key
// is written here so it never leaves ARM.
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource storageKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'storage-key'
  properties: {
    value: storage.listKeys().keys[0].value
    contentType: 'Litestream replica account key (managed by main.bicep)'
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, identity.id, kvSecretsUserRoleId)
  scope: kv
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: kvSecretsUserRoleId
  }
}

resource kvAudit 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'audit-to-log-analytics'
  scope: kv
  properties: {
    workspaceId: logs.id
    logs: [{ categoryGroup: 'audit', enabled: true }]
  }
}

// Container App secrets that resolve from Key Vault via the app identity.
func kvSecret(name string, vaultUri string, identityId string) object => {
  name: name
  keyVaultUrl: '${vaultUri}secrets/${name}'
  identity: identityId
}

var registries = useRegistry ? [{ server: containerRegistryServer, identity: identity.id }] : []

// ─── Container Apps environment ────────────────────────────────────────
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

// ACA's default hostname is <app>.<env default domain>, so ORIGIN is known
// before the app exists. Magic links are built from ORIGIN, never from Host.
var appOrigin = 'https://${appName}.${cae.properties.defaultDomain}'

// Container Apps rejects empty secret values, so optional secrets are only
// declared (and referenced) when supplied.
var vaultUri = kv.properties.vaultUri
var coreSecrets = [
  kvSecret('auth-secret', vaultUri, identity.id)
  kvSecret('storage-key', vaultUri, identity.id)
]
var optionalSecrets = concat(
  hasPostmarkToken ? [kvSecret('postmark-token', vaultUri, identity.id)] : [],
  hasAnthropicKey ? [kvSecret('anthropic-api-key', vaultUri, identity.id)] : []
)
var optionalEnv = concat(
  !hasPostmarkToken
    ? [{ name: 'EMAIL_TRANSPORT', value: 'stdout' }]
    : [
        { name: 'EMAIL_TRANSPORT', value: 'postmark' }
        { name: 'POSTMARK_TOKEN', secretRef: 'postmark-token' }
      ],
  empty(emailFrom) ? [] : [{ name: 'EMAIL_FROM', value: emailFrom }],
  hasAnthropicKey ? [{ name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }] : []
)

// ─── Container App ─────────────────────────────────────────────────────
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull, kvSecretsUser, storageKeySecret]
  properties: {
    managedEnvironmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: concat(coreSecrets, optionalSecrets)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(
            [
              { name: 'NODE_ENV', value: 'production' }
              { name: 'HOST', value: '0.0.0.0' }
              { name: 'PORT', value: '8080' }
              { name: 'DATABASE_URL', value: 'file:/data/cropcard.db' }
              { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
              { name: 'AUTH_MODE', value: authMode }
              { name: 'ORIGIN', value: appOrigin }
              { name: 'ADDRESS_HEADER', value: 'X-Forwarded-For' }
              { name: 'XFF_DEPTH', value: '1' }
              { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
              { name: 'AZURE_STORAGE_KEY', secretRef: 'storage-key' }
              { name: 'AZURE_BLOB_CONTAINER', value: blobContainerName }
            ],
            optionalEnv
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 8080 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        // Single-writer SQLite — never scale beyond one replica.
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

// ─── Marketplace Container App (Phase 23, optional) ────────────────────
// ClamAV sidecar in the same pod; the marketplace reaches clamd on localhost.
resource marketplaceApp 'Microsoft.App/containerApps@2024-03-01' = if (deployMarketplace) {
  name: marketplaceAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull, kvSecretsUser, storageKeySecret]
  properties: {
    managedEnvironmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: concat(
        coreSecrets,
        hasMarketplaceSeed ? [kvSecret('marketplace-seed-credential', vaultUri, identity.id)] : []
      )
    }
    template: {
      containers: [
        {
          name: 'marketplace'
          image: marketplaceImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat([
            { name: 'NODE_ENV', value: 'production' }
            { name: 'HOST', value: '0.0.0.0' }
            { name: 'PORT', value: '8080' }
            { name: 'DATABASE_URL', value: 'file:/data/marketplace.db' }
            { name: 'DB_PATH', value: '/data/marketplace.db' }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_STORAGE_KEY', secretRef: 'storage-key' }
            { name: 'AZURE_BLOB_CONTAINER', value: marketplaceBlobContainerName }
            { name: 'MARKETPLACE_MODE', value: 'internet' }
            { name: 'MARKETPLACE_ADMIN_EMAILS', value: marketplaceAdminEmails }
            { name: 'CLAMAV_HOST', value: 'localhost' }
            { name: 'CLAMAV_PORT', value: '3310' }
          ], hasMarketplaceSeed ? [{ name: 'MARKETPLACE_SEED_CREDENTIAL', secretRef: 'marketplace-seed-credential' }] : [])
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/v1/health', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/v1/health', port: 8080 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
        {
          // First boot pulls ~150 MB of signatures via freshclam.
          name: 'clamav'
          image: 'clamav/clamav:stable'
          resources: {
            cpu: json('0.5')
            memory: '2Gi'
          }
          env: [
            { name: 'CLAMAV_NO_FRESHCLAMD', value: 'false' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output appFqdn string = app.properties.configuration.ingress.fqdn
output appOrigin string = appOrigin
output marketplaceFqdn string = deployMarketplace ? marketplaceApp!.properties.configuration.ingress.fqdn : ''
output storageAccount string = storage.name
output blobContainer string = blobContainerName
