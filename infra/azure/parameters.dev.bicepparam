using './main.bicep'

param project = 'cropcard'
param env = 'dev'
param location = 'eastus2'
param authMode = 'magic-link'
param deployMarketplace = false
param dnsZoneName = 'cropcard.io'
param customHosts = ['app', 'www']

// Supplied at deploy time by scripts/deploy-azure.sh:
//   image, containerRegistryServer, keyVaultName, hasPostmarkToken, hasAnthropicKey, emailFrom,
//   customDomainDnsReady, customDomainCertIssued
// Secret values live only in the Key Vault; see scripts/set-azure-secret.sh.
param image = ''
param keyVaultName = ''
