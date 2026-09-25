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

@description('HMAC session signing secret (32-byte random). Rotating it signs everyone out.')
@secure()
param authSecret string

@description('UC-17 sign-in mode. magic-link disables the direct/demo sign-in.')
@allowed(['magic-link', 'direct'])
param authMode string = 'magic-link'

@description('Postmark server token. Empty = magic links and invites are written to the container log instead of emailed.')
@secure()
param postmarkToken string = ''

@description('From-address for outbound email (Postmark sender signature).')
param emailFrom string = ''

@description('Anthropic API key. Empty = no-key mode (Invariant 7: deterministic fallbacks).')
@secure()
param anthropicApiKey string = ''

@description('Deploy the plugin marketplace app (with its ClamAV sidecar). The web app does not depend on it.')
param deployMarketplace bool = false

@description('Container image reference for the marketplace.')
param marketplaceImage string = image

@description('Comma-separated list of operator emails allowed to sign in to the marketplace admin UI.')
param marketplaceAdminEmails string = ''

@description('Optional seed credential for the marketplace on first boot (format ccm_<base64url>).')
@secure()
param marketplaceSeedCredential string = ''

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
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dff-4ed7-4f47-8e2e-b6e7d4b1e2f5')

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
var optionalSecrets = concat(
  empty(postmarkToken) ? [] : [{ name: 'postmark-token', value: postmarkToken }],
  empty(anthropicApiKey) ? [] : [{ name: 'anthropic-api-key', value: anthropicApiKey }]
)
var optionalEnv = concat(
  empty(postmarkToken)
    ? [{ name: 'EMAIL_TRANSPORT', value: 'stdout' }]
    : [
        { name: 'EMAIL_TRANSPORT', value: 'postmark' }
        { name: 'POSTMARK_TOKEN', secretRef: 'postmark-token' }
      ],
  empty(emailFrom) ? [] : [{ name: 'EMAIL_FROM', value: emailFrom }],
  empty(anthropicApiKey) ? [] : [{ name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }]
)

// ─── Container App ─────────────────────────────────────────────────────
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull]
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
        [
          { name: 'auth-secret', value: authSecret }
          { name: 'storage-key', value: storage.listKeys().keys[0].value }
        ],
        optionalSecrets
      )
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
  dependsOn: [acrPull]
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
      secrets: [
        { name: 'auth-secret', value: authSecret }
        { name: 'storage-key', value: storage.listKeys().keys[0].value }
        { name: 'marketplace-seed-credential', value: empty(marketplaceSeedCredential) ? 'unset' : marketplaceSeedCredential }
      ]
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
          env: [
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
            { name: 'MARKETPLACE_SEED_CREDENTIAL', secretRef: 'marketplace-seed-credential' }
            { name: 'CLAMAV_HOST', value: 'localhost' }
            { name: 'CLAMAV_PORT', value: '3310' }
          ]
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
