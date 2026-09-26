# Email consent and unsubscribe

CropCard sends two kinds of email, and the difference decides whether consent is needed.

| Kind (`OutboundEmail.kind`) | Class         | Pingram `type`  | Why                                                                                             |
| --------------------------- | ------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `magic-link`                | transactional | `magic-link`    | The person just asked to sign in.                                                               |
| `contact-code`              | transactional | `contact-code`  | The person is adding this address.                                                              |
| `helper-invite`             | transactional | `helper-invite` | An owner invited this address to their farm.                                                    |
| `field-alert`               | opt-in        | `field-alerts`  | Decon due, record lock closing, spring calibration, frost tonight, and the Settings test email. |

Billing receipts come from Stripe, not from CropCard. There is no marketing mail. The class table lives in `EMAIL_KIND_CLASS` (`apps/web/src/lib/server/email.ts`); a test fails if a new kind is added without a class.

## Opt-in

- Consent is per (farm, user, alert kind) in the tenant-scoped `email_alert_consents` table (migration 0058). No row means off. Opting in stores the time, the source (`settings` or `unsubscribe-page`) and the client IP; opting out keeps the row with `status = 'opted-out'`.
- It is per farm, like push subscriptions, because the alerts are about one farm's sprayers and records and a helper on two farms may want only one.
- The only place to opt in is `/settings/notifications` (`POST /api/email/prefs`). It needs the signed-in browser session: API tokens and impersonation are refused, so nobody opts a person in on their behalf.
- The twice-daily alert tick (`POST /api/internal/push-tick`, woken by the `push-tick` Container Apps Jobs; `lib/server/push/wakeup.ts` and `scheduler.ts`) sends each due alert by push and, through `lib/server/push/emailAlerts.ts`, by email to users with an opt-in for that exact kind. The tick runs when push or email is configured. Email needs a real `EMAIL_TRANSPORT` and `ORIGIN`; `EMAIL_ALERTS=off` stops alert email only. There are no quiet hours in CropCard today, so none are applied.

## Unsubscribe

Every opt-in email carries:

- a visible link to `/unsubscribe/<token>` and a link to `/settings/notifications`;
- `List-Unsubscribe: <https://…/api/email/unsubscribe?t=<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 2369 and RFC 8058) when the transport accepts custom headers (Postmark, and the stdout and memory transports).

The token (`lib/server/emailUnsubscribe.ts`) is an HMAC over the user id, farm id and category, keyed from `AUTH_SECRET` with its own purpose label. It never expires, works signed out and can only change that one person's alert email on that farm.

- `POST /api/email/unsubscribe?t=…` is the RFC 8058 one-click target. It is idempotent and needs `List-Unsubscribe=One-Click` in the body. Mail providers send it server-to-server with no `Origin`, so it is the one path exempt from the cross-site form guard (`formCsrfForbidden` in `hooks.server.ts`, which replaced SvelteKit's `csrf.checkOrigin` with the same rule everywhere else).
- `GET /unsubscribe/<token>` only shows what will be turned off. One button turns it off, a second turns off every alert email from that farm, and the result page offers to turn the same alerts back on. GET never changes anything, so link scanners (Outlook Safe Links and similar) cannot quietly switch off someone's decon reminders; the same reasoning as the magic-link confirm page.

## Pingram

Findings from the Pingram SDK (`pingram@1.0.34`) and its public docs as of 2026-09:

- `POST /email` has no field for custom headers, so CropCard cannot set its own `List-Unsubscribe` on Pingram sends. Pingram says it adds RFC 2369/8058 headers pointing at its own hosted unsubscribe page, scoped to the notification `type`. That is why alert mail uses its own type (`field-alerts`): unsubscribing from alerts on Pingram's page never blocks sign-in mail.
- Pingram has no hosted opt-in or sign-up form, only the hosted unsubscribe page and an embeddable preferences widget. Opt-in therefore lives in CropCard, and CropCard's database is the authority: nothing is sent without a consent row, whatever Pingram's defaults are.
- Pingram reports unsubscribes back through its events webhook. `POST /api/email/pingram-webhook` verifies `X-Pingram-Signature` (`v1,<hex>` HMAC-SHA256 over `id.timestamp.body`, 300 s tolerance) with `PINGRAM_WEBHOOK_SECRET` and records `EMAIL_UNSUBSCRIBE`, bounce or complaint `EMAIL_FAILED`, `SMS_UNSUBSCRIBE` and `SMS_SUBSCRIBE` in the global `contact_suppressions` table, keyed by address. An unsubscribed, bounced or complained address gets no alert email; a plain delivery failure is only logged. Ticking a box in Settings again is a fresh opt-in and lifts an earlier unsubscribe (not a bounce or complaint).

### Launch checklist

1. In the Pingram dashboard, add an events webhook to `https://app.cropcard.io/api/email/pingram-webhook` for `EMAIL_UNSUBSCRIBE`, `EMAIL_FAILED`, `SMS_UNSUBSCRIBE` and `SMS_SUBSCRIBE`, then store its secret with `./scripts/set-azure-secret.sh pingram-webhook-secret` and redeploy.
2. Mark the `magic-link`, `contact-code` and `helper-invite` types as transactional in Pingram if it offers that, so its unsubscribe page never covers them.
3. After domain verification, send one alert email to a Gmail inbox and check "Show original" for Pingram's `List-Unsubscribe` and `List-Unsubscribe-Post` headers, and which `userId` the resulting `EMAIL_UNSUBSCRIBE` webhook carries (the handler accepts an address or a CropCard user id).
4. A re-opt-in in CropCard does not yet clear Pingram's own unsubscribe for the `field-alerts` type. If a person opts back in after using Pingram's page, clear it in the Pingram dashboard (or wire Pingram's preferences API later).
