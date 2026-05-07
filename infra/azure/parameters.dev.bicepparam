using './main.bicep'

param project = 'cropcard'
param env = 'dev'
param location = 'eastus2'
param image = 'ghcr.io/CHANGE_ME/cropcard:latest'
param emailFrom = 'cropcard@example.com'

// Secrets are passed at deploy time via:
//   az deployment group create ... --parameters authSecret=$AUTH_SECRET emailApiKey=$RESEND_API_KEY
param authSecret = ''
param emailApiKey = ''
