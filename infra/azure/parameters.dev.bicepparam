using './main.bicep'

param project = 'cropcard'
param env = 'dev'
param location = 'eastus2'
param authMode = 'magic-link'
param deployMarketplace = false
param dnsZoneName = 'cropcard.io'
param customHosts = ['app', 'www', '@']

// Mail is sent by Pingram (Amazon SES): DKIM d=cropcard.io via pingram._domainkey,
// custom MAIL FROM pingram.cropcard.io via the MX + SPF on `pingram`. Both align
// with the From domain only under relaxed DMARC alignment (adkim=r, aspf=r).
// A domain has one DMARC record, so edit _dmarc here rather than adding another.
// Add rua=mailto:dmarc@cropcard.io once that mailbox (or an aggregator address)
// exists; this zone declares no apex MX yet, so reports would bounce. Then
// p=quarantine; pct=25 → pct=100 → p=reject, back to p=none at once if sign-in
// mail ever fails alignment. When Microsoft 365 mail is set up, its apex SPF is
// '@': 'v=spf1 include:spf.protection.outlook.com ~all', with no amazonses
// include (SES bounces use the pingram subdomain).
param dnsTxtRecords = {
  _dmarc: 'v=DMARC1; p=none; adkim=r; aspf=r'
  pingram: 'v=spf1 include:amazonses.com ~all'
  'pingram._domainkey': 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDMdMcEEKQKe8sthhLsGcg8O8gB2FHSjgphaZfBNHeifqDwzQkCFer1QiO0AkF8+kEVVgtidUL2DpGHuDa+63tz0e7tAoU4dzcpTY2Pnbz6ju9hvSsFr+708B3ClJ5cZIC1Rxm2lQBCI4dLsbNr6snH6i8s7WygD1n26TZ44umNSQIDAQAB'
}
param dnsMxRecords = {
  pingram: [{ preference: 10, exchange: 'feedback-smtp.us-east-1.amazonses.com' }]
}

// Set to 'hello@cropcard.io' only once Pingram's domain check passes (dkim,
// mail_from_mx, mail_from_spf, dmarc). Until then Pingram's built-in sender
// keeps sign-in mail flowing. EMAIL_FROM in the deploy environment overrides it.
param emailFrom = ''
param vapidSubject = 'mailto:hello@cropcard.io'

// The free pool plus about 20 Grower budgets plus headroom. Recompute monthly
// as free pool + (paid owners x plan budget) x 0.6 + 25 and alert at 80%.
param aiGlobalMonthlyUsdCap = '150'
param aiFreePoolMonthlyUsd = '50'

// Supplied at deploy time by scripts/deploy-azure.sh:
//   image, containerRegistryServer, keyVaultName, hasPingramKey, hasPostmarkToken,
//   hasAnthropicKey, presentSecrets, customDomainDnsReady, customDomainCertIssued
// Secret values live only in the Key Vault; see scripts/set-azure-secret.sh.
param image = ''
param keyVaultName = ''
