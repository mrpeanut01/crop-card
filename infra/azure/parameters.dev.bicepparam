using './main.bicep'

param project = 'cropcard'
param env = 'dev'
param location = 'eastus2'
param authMode = 'magic-link'
param deployMarketplace = false
param dnsZoneName = 'cropcard.io'
param customHosts = ['app', 'www', '@']
param dnsTxtRecords = {
  'pingram._domainkey': 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDMdMcEEKQKe8sthhLsGcg8O8gB2FHSjgphaZfBNHeifqDwzQkCFer1QiO0AkF8+kEVVgtidUL2DpGHuDa+63tz0e7tAoU4dzcpTY2Pnbz6ju9hvSsFr+708B3ClJ5cZIC1Rxm2lQBCI4dLsbNr6snH6i8s7WygD1n26TZ44umNSQIDAQAB'
}

// Supplied at deploy time by scripts/deploy-azure.sh:
//   image, containerRegistryServer, keyVaultName, hasPostmarkToken, hasAnthropicKey, emailFrom,
//   customDomainDnsReady, customDomainCertIssued
// Secret values live only in the Key Vault; see scripts/set-azure-secret.sh.
param image = ''
param keyVaultName = ''
