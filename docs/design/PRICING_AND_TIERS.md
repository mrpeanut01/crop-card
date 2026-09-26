# Pricing, plans and go-live mail settings

Decision record, 2026-09-26. Owner: Shawn (Safe Haven Farm, Loudoun County, VA).

This page records why CropCard launches with three plans, what each one costs us to run, and how the sign-in and alert mail is set up so it keeps arriving. The code lives in `apps/web/src/lib/billing/plans.ts` (pure entitlements), `apps/web/src/lib/server/billing/plans.ts` (`resolvePlan`), `apps/web/src/lib/server/aiGuard.ts` (budgets and caps) and `infra/azure/` (secrets and DNS).

## The rule

Safety, records, compliance exports and deterministic planning are free on every plan, with no limits and no end date. Paid plans buy more AI help and more helper seats. Nothing that keeps a farm legal or safe is ever behind a payment.

## Plans

| Plan   | Price                               | Helper seats | AI budget a month | Web-search AI features |
| ------ | ----------------------------------- | ------------ | ----------------- | ---------------------- |
| Free   | $0, no card, no end date            | 2            | $0.50             | Off                    |
| Grower | $10 a month or $96 a year ($8/mo)   | 5            | $4.00             | On                     |
| Farm   | $20 a month or $192 a year ($16/mo) | 15           | $10.00            | On                     |

Free includes every record flow (spray, insecticide, fungicide, harvest, hay, fertility, scout, decon, calibration, winterization, season close-out), the whole safety kernel with the 48 hour lock and the hash chain, inventory with manual and barcode entry, the calendar and schedule, the deterministic allocation, inputs and carry-forward planning, the garden designer's recipe fallback, weather gates, the offline app, Web Push, and every export (CSV, PDF, USDA, VDACS, year summary and the full data export). API tokens work on every plan and spend the owner's AI budget.

A Free farm gets a one-time starter boost: its AI budget is $1.00 for the first 30 days after the farm is created, once per verified email or phone. That is the allowance meant to let a grower feel what the AI does.

Grower adds the web-search features: plugin name search, the stock AI refresh and receipt batch scans. Farm roughly doubles Grower's daily caps and comes with priority email support. The yearly price is the default on `/settings/billing` because it cuts the card fee per dollar almost in half.

### AI rules on every plan

- Helpers' and API tokens' calls count against the owner's budget. Per-token daily quotas still apply on top.
- An owner may lower their own monthly cap but never raise it above the plan's. A cap of 0 turns AI off.
- Before each call the guard reserves that call's worst-case cost and refuses when spent plus reserve would pass the cap, so spend cannot overshoot the budget.
- When a budget or a daily cap runs out, the feature falls back to its deterministic result through `aiTry` with the `over-cap` reason. The person sees a "More AI on Grower" nudge and is never blocked. No-key mode is unchanged.

### Daily caps per feature (Free / Grower / Farm)

The monthly budget is the real brake. The daily caps only stop a whole month being spent in one day.

| Feature                                  | Free | Grower | Farm |
| ---------------------------------------- | ---- | ------ | ---- |
| suggest                                  | 5    | 20     | 40   |
| succession                               | 5    | 20     | 40   |
| planting-window (cached per crop, year)  | 10   | 40     | 40   |
| garden-fill                              | 3    | 10     | 20   |
| photo-help                               | 3    | 10     | 20   |
| inputs                                   | 2    | 10     | 20   |
| shortNames                               | 2    | 5      | 10   |
| scan-barcode                             | 10   | 40     | 60   |
| scan-label                               | 3    | 20     | 40   |
| scan-url                                 | 1    | 10     | 20   |
| plugin-scan                              | 1    | 10     | 20   |
| allocate (schedule and refine draw here) | 1    | 5      | 10   |
| groups                                   | 1    | 5      | 10   |
| optimize                                 | 0    | 2      | 5    |
| plugin-search (web search)               | 1    | 10     | 15   |
| rationale, the stock AI refresh          | 0    | 10     | 20   |
| plugin-batch-scan, receipts              | 0    | 1      | 3    |

A cap of 0 degrades through the existing `over-cap` path, so no new degradation condition was needed.

### What a budget buys

At the researched unit costs, $0.50 is about three or four full AI plans, or about 100 cheap Haiku calls, or a mix such as one plan, 30 photo questions and five label scans. That is close to Seedtime's ten free credits. Grower's $4 is about 30 plans, or 20 web-search enrichments plus daily light use. Farm's $10 covers heavy use including receipt scans.

## Trials, failed payments, downgrades and cancelling

There is no card-required trial and no Stripe `trial_period_days`. Free is the trial, plus the starter boost. Paid plans carry a 30-day money-back guarantee on the first payment, refunded by hand from the Stripe dashboard. A trialing subscription created by hand still maps to `trial` and gets the paid plan's caps.

Nobody is ever locked out of their own records.

- **Failed payment.** On `past_due` the paid plan stays for 7 days from the first failure while Stripe's Smart Retries run, and the owner sees a banner that links to the Billing Portal. After 7 days, or on `unpaid`, `incomplete_expired` or `canceled`, the farm resolves to Free. `incomplete` (the first checkout payment failed) never grants a paid plan.
- **Cancel.** The paid plan runs to the end of the period, then `customer.subscription.deleted` moves the farm to Free.
- **Farm to Grower** through the Portal follows Stripe's proration schedule.
- **After any downgrade** records, plans, farm plugin copies and exports stay fully readable and writable. AI caps change at once, and money already spent this month counts against the new cap, so AI may fall back to deterministic results for the rest of the month. Helpers over the new seat limit keep their access. Only new invites wait until the farm is under the limit, because removing a helper mid-season would break spray logging.
- **Suspended** is set only by a superadmin, for fraud or terms abuse, never by Stripe. Even then the farm keeps record pages, record exports, the year summary, the full data export, billing and sign-out.

## Why these choices

**The free floor.** LiteFarm is free and has no AI, so CropCard's free plan has to include every record, compliance and safety feature. Spray, VDACS and USDA records are a legal need; charging for them would break trust and Invariant 7.

**What people pay for.** AI is the one thing CropCard has that LiteFarm lacks, so paid plans sell AI headroom plus seats. Seedtime is the closest precedent, with ten AI credits a month free and paid plans at $84 and $168 a year. Grower at $96 a year sits beside Seedtime's basic plan and far below Farmbrite ($29 a month and up). Farm at $192 a year sits beside Seedtime's unlimited plan.

**Prices set by what each farm costs.** At $10 and $20 every paid plan still makes money after card fees (3.6% plus $0.30) even when a customer spends the whole AI budget every month. Plans under about $8 a month lose too much to the fixed $0.30 fee. Yearly billing cuts the fee from about 6.6% to about 3.9% of the price.

**AI budgets.** Grower gets $4 rather than the old $5 default. At $5 the yearly margin would shrink to $2.69 a month; $4 leaves room for estimate error. Free gets $0.50, with the $1 first-month boost: enough to feel the value, and a small, known cost per farm.

**Two ideas we did not take.** A 30-day Grower trial: Free plus the boost is simpler and harder to abuse. Pausing helpers on downgrade: it would break spray logging mid-season, so seats are grandfathered instead.

**Guard fixes that blocked go-live.** Before this change an owner could set `ai_monthly_usd_cap` to 0 and get unlimited AI, because the guard read `cap > 0 && spent >= cap`. The cost estimate also ignored web-search fees and cache writes, so the most expensive features were under-counted. Both are fixed, with regression tests.

## Economics

Assumptions: Stripe US card fees are 2.9% plus $0.30 per charge, plus 0.7% for Stripe Billing, so 3.6% plus $0.30. Worst case means the owner spends the full plan budget every month; the reserve-before-call guard makes that the real ceiling. Email costs about $0.0005 each and push is free. SMS is about $0.01 each and only for phone sign-in; allow about $0.10 per owner a month, bounded by the sign-in code send limits. Hosting is a fixed cost for the whole service and is not counted per farm.

### Paid plans at the worst case

| Plan           | Price   | Card fee | Net revenue         | Worst-case AI | Margin at worst case |
| -------------- | ------- | -------- | ------------------- | ------------- | -------------------- |
| Grower monthly | $10.00  | $0.66    | $9.34               | $4.00         | about +$5.24 a month |
| Grower yearly  | $96.00  | $3.76    | $92.24 ($7.69/mo)   | $4.00         | about +$3.59 a month |
| Farm monthly   | $20.00  | $1.02    | $18.98              | $10.00        | about +$8.88 a month |
| Farm yearly    | $192.00 | $7.21    | $184.79 ($15.40/mo) | $10.00        | about +$5.30 a month |

An engaged grower typically spends $0.40 to $0.80 of AI a month, which leaves about $7 to $8.50 a month on Grower and about $14 to $18 on Farm.

### Free farms

Per active farm per month the worst case is $0.50 of AI ($1.00 in the first 30 days), up to $0.20 of SMS for phone sign-ins, and next to nothing for email and push: about $0.70, or $1.20 in the first month. Receipt scans are off on Free and the most expensive single Free call is about $0.25. A typical free farm costs $0.05 to $0.30.

Across all free farms, `AI_FREE_POOL_MONTHLY_USD=50` caps total free AI at $50 a month however many farms sign up. Past it, free AI falls back to deterministic results and paying farms are untouched. That is about 100 fully used free farms or several hundred typical ones. Pingram's free allowance (3,000 emails and 100 SMS a month) covers early launch; after that $20 a month buys about 40,000 emails or 2,000 texts.

### The global brake

`AI_GLOBAL_MONTHLY_USD_CAP=150` at launch: the $50 free pool plus about 20 Grower budgets plus headroom. Recompute it monthly as the free pool plus 0.6 times the sum of paid budgets plus $25, and alert at 80%. Per-farm caps are checked first, so the global cap should never bind in normal use.

An optional cost lever, after a quality check: moving the planning and scan calls from Sonnet 4.6 ($3 and $15 per million tokens) to Sonnet 5 ($2 and $10) would cut those costs by about a third and widen every margin above.

Competitor, Stripe and Pingram prices came from search results because the pricing pages were blocked from the build environment. Check them against the live pages before publishing prices.

## Sign-in and email

Sign-in leads with email. The landing page asks for an email address and sends one message with a sign-in link and a 6-digit backup code. "Use a phone number instead" is a second path that texts a code and carries the consent line: "CropCard will text you a sign-in code. Msg & data rates may apply. Reply STOP to opt out, HELP for help." The SMS use case is registered with carriers as 2FA or one-time passcodes.

Sign-in codes, address codes and helper invites are transactional and go out without consent. Billing receipts come from Stripe. Everything else is opt-in: field alerts reach email only for people who tick that alert on `/settings/notifications`, and every alert email carries a signed unsubscribe link plus one-click unsubscribe headers where the transport allows them. Pingram has no hosted opt-in form, so consent lives in CropCard's database, which is the authority. Details are in [`docs/email-consent.md`](../email-consent.md).

Web Push is on, with `VAPID_SUBJECT=mailto:hello@cropcard.io`. `EMAIL_FROM=hello@cropcard.io` is set only after Pingram's domain check passes.

## Mail DNS and DMARC

The `cropcard.io` name servers are delegated to the Azure DNS zone, so every mail record lives in `infra/azure/parameters.dev.bicepparam` and a record at the registrar is ignored.

| Name                 | Type | Value                                      |
| -------------------- | ---- | ------------------------------------------ |
| `pingram`            | MX   | 10 `feedback-smtp.us-east-1.amazonses.com` |
| `pingram`            | TXT  | `v=spf1 include:amazonses.com ~all`        |
| `pingram._domainkey` | TXT  | Pingram's DKIM key (unchanged)             |
| `_dmarc`             | TXT  | `v=DMARC1; p=none; adkim=r; aspf=r; fo=1`  |

The MX and SPF on `pingram` are Amazon SES's custom MAIL FROM pair. A domain may have only one DMARC record, so `_dmarc` is edited in place, never added twice.

Relaxed alignment (`adkim=r`, `aspf=r`) is required. Pingram signs DKIM as `d=cropcard.io` through `pingram._domainkey` and bounces through `pingram.cropcard.io`, and both align with the From domain only in relaxed mode. `p=none` already meets the Gmail and Yahoo bulk-sender rules. Launch does not go stricter than `p=none`, because the magic link is the main way in and a misaligned sender under quarantine would quietly hide sign-in mail.

Reports: the record goes out without `rua=` until a mailbox exists. Create `dmarc@cropcard.io` as a Microsoft 365 shared mailbox or alias (which also needs an apex MX added to `dnsMxRecords`), or use a free DMARC report aggregator's address, then publish `v=DMARC1; p=none; rua=mailto:dmarc@cropcard.io; adkim=r; aspf=r; fo=1`. When Microsoft 365 mail is set up, the apex SPF is `v=spf1 include:spf.protection.outlook.com ~all` only, with no amazonses include, since SES bounces use the pingram subdomain.

### Tightening plan

1. Weeks 0 to 3 at `p=none`. Before moving on, confirm that Pingram's domain check passes for dkim, mail_from_mx, mail_from_spf and dmarc; that Microsoft 365 DKIM is on with its selector1 and selector2 `_domainkey` CNAMEs published in Azure DNS; and that the aggregate reports show every real sender (Pingram, Microsoft 365, and anything else sending as the domain) passing aligned SPF or DKIM.
2. Weeks 3 to 5: `v=DMARC1; p=quarantine; pct=25; rua=...; adkim=r; aspf=r; fo=1`. Raise `pct` to 100 after a clean week.
3. After 30 more clean days at quarantine with `pct=100`, move to `p=reject` (subdomains inherit).
4. Go back to `p=none` at once if the reports ever show sign-in mail failing alignment.
