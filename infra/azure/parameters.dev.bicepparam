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
// Mail to @cropcard.io is received by Microsoft 365 (renefamily.com tenant): the
// apex MX, autodiscover CNAME, MS= verification and apex SPF are Microsoft's.
// The apex SPF covers only Microsoft 365; Pingram's SPF lives on `pingram`, so
// never add amazonses to the apex. A domain has one DMARC record, so edit
// _dmarc here rather than adding another. Aggregate reports go to
// dmarc@cropcard.io (an alias in Microsoft 365). Tighten to p=quarantine;
// pct=25 → pct=100 → p=reject once reports are clean, and back to p=none at once
// if sign-in mail ever fails alignment.
param dnsTxtRecords = {
  '@': ['MS=ms51704775', 'v=spf1 include:spf.protection.outlook.com -all']
  _dmarc: ['v=DMARC1; p=none; rua=mailto:dmarc@cropcard.io; adkim=r; aspf=r; fo=1']
  pingram: ['v=spf1 include:amazonses.com ~all']
  'pingram._domainkey': ['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDMdMcEEKQKe8sthhLsGcg8O8gB2FHSjgphaZfBNHeifqDwzQkCFer1QiO0AkF8+kEVVgtidUL2DpGHuDa+63tz0e7tAoU4dzcpTY2Pnbz6ju9hvSsFr+708B3ClJ5cZIC1Rxm2lQBCI4dLsbNr6snH6i8s7WygD1n26TZ44umNSQIDAQAB']
}
param dnsMxRecords = {
  '@': [{ preference: 0, exchange: 'cropcard-io.mail.protection.outlook.com' }]
  pingram: [{ preference: 10, exchange: 'feedback-smtp.us-east-1.amazonses.com' }]
}
param dnsCnameRecords = {
  autodiscover: 'autodiscover.outlook.com'
}

// Pingram's domain checks (dkim, mail_from_mx, mail_from_spf, dmarc) passed on
// 2026-09-27, so mail goes out from hello@cropcard.io. EMAIL_FROM in the deploy
// environment overrides it.
param emailFrom = 'hello@cropcard.io'
param vapidSubject = 'mailto:hello@cropcard.io'

// The free pool plus about 20 Grower budgets plus headroom. Recompute monthly
// as free pool + (paid owners x plan budget) x 0.6 + 25 and alert at 80%.
param aiGlobalMonthlyUsdCap = '150'
param aiFreePoolMonthlyUsd = '50'
param githubFeedbackRepo = 'mrpeanut01/crop-card'

// Supplied at deploy time by scripts/deploy-azure.sh:
//   image, containerRegistryServer, keyVaultName, hasPingramKey, hasPostmarkToken,
//   hasAnthropicKey, hasPushTickSecret, hasVapidKeys, presentSecrets, emailFrom,
//   alertEmail, customDomainDnsReady, customDomainCertIssued
// Secret values live only in the Key Vault; see scripts/set-azure-secret.sh.
param image = ''
param keyVaultName = ''
