// CropCard — Azure Container Apps deployment.
//
// Cheap, single-replica, scale-to-zero. Single-writer SQLite + Litestream → Blob.
//
// Outputs the FQDN of the ACA ingress so CI can smoke-test after deploy.

@description('Project tag, also used as a name prefix.')
param project string = 'cropcard'

@description('Environment short name (dev | prod).')
param env string = 'dev'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image reference, e.g. ghcr.io/owner/cropcard:sha-abc1234.')
param image string

@description('Email magic-link API key (Resend or similar). Stored as a secret.')
@secure()
param emailApiKey string

@description('Auth.js signing secret (32-byte random).')
@secure()
param authSecret string

@description('From-address for magic-link emails.')
param emailFrom string

// Names
var prefix = '${project}-${env}'
var storageName = toLower(replace('${prefix}stg', '-', ''))
var logsName = '${prefix}-logs'
var envName = '${prefix}-cae'
var appName = '${prefix}-app'
var blobContainerName = 'cropcard'

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

// ─── Log Analytics workspace (required by ACA) ─────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

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

// ─── Container App ─────────────────────────────────────────────────────
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        { name: 'auth-secret', value: authSecret }
        { name: 'email-api-key', value: emailApiKey }
        { name: 'storage-key', value: storage.listKeys().keys[0].value }
      ]
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
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'HOST', value: '0.0.0.0' }
            { name: 'PORT', value: '8080' }
            { name: 'DATABASE_URL', value: 'file:/data/cropcard.db' }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'AUTH_TRUST_HOST', value: 'true' }
            { name: 'EMAIL_FROM', value: emailFrom }
            { name: 'RESEND_API_KEY', secretRef: 'email-api-key' }
            { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_STORAGE_KEY', secretRef: 'storage-key' }
            { name: 'AZURE_BLOB_CONTAINER', value: blobContainerName }
          ]
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

output appFqdn string = app.properties.configuration.ingress.fqdn
output storageAccount string = storage.name
output blobContainer string = blobContainerName
