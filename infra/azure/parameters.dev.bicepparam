using './main.bicep'

param project = 'cropcard'
param env = 'dev'
param location = 'eastus2'
param authMode = 'magic-link'
param deployMarketplace = false

// Supplied at deploy time by scripts/deploy-azure.sh:
//   image, containerRegistryServer, authSecret
//   postmarkToken / emailFrom / anthropicApiKey (optional; from the environment)
param image = ''
param authSecret = ''
