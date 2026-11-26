# Phase 38: Sign in with a passkey

Status: proposed, 2026-11-26. Nothing in this plan is built yet.

## Why

Sessions last 7 days, so most people sign in about once a week on each device. Today that means typing an email, leaving the app, finding the message and coming back, or waiting for a text that costs us money per message. A passkey turns that into one tap and a face, fingerprint or device PIN. It also cannot be phished, because the browser only offers it to the CropCard site.

The email link and the SMS code stay. They are how a person first proves who they are, how they get back in when they lose a device, and the only way in on a device that cannot hold a passkey.

## How it fits what exists

`magicLink.ts` and `loginCodes.ts` each prove an identity and then call `startSession(event, row)` in `lib/server/auth.ts`, which mints the HMAC cookie and picks where the user lands. A passkey is a third proof that ends in the same call. Nothing below `startSession` changes: the cookie format, `revalidateCookieUser`, roles, tenant choice, the Owner picker, "Sign out everywhere" (`users.sessions_valid_after`) and impersonation all behave as they do now.

## The person's journey

**First sign-in on a new account.** Unchanged. They enter an email (or a phone number), open the link or type the code, and land on onboarding or /today.

**Right after a sign-in by email or SMS.** If the device can hold a passkey (`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` is true), a card offers "Sign in faster next time with Face ID, your fingerprint or your device PIN." Tapping **Add a passkey** opens the device's own prompt. "Not now" hides the card for this sign-in.

**Every sign-in after that, on a device that holds the passkey.** The sign-in page's Email field shows the passkey in the browser's autofill list ("you@farm.com · CropCard"). One tap and a face or fingerprint signs them in. Nothing is typed.

**On a device that does not hold the passkey** (a borrowed laptop, a new computer, the office PC). See the QR code ruling below. In short, the page has a **Use a passkey** button, and the browser offers its own "Use a phone or tablet" option, which shows a QR code that the person scans with the phone holding their passkey. Once they are in, the add-a-passkey card offers to put a passkey on this device too, so next time it is one tap.

**When nothing works.** The email link and the code are always on the same page, one tap away.

## The QR code question (resolved)

**Question.** If the passkey is not on the device in front of the person, do we show a 2D barcode for them to scan with their phone?

**Ruling P38-1: Yes, but the browser draws it, and CropCard does not.** WebAuthn has a cross-device flow (the "hybrid" transport, often called caBLE) built into every current browser and operating system. When CropCard asks for a passkey and the device has none for this site, the browser's own sheet offers "Use a phone or tablet" (the wording varies by browser). It then shows a QR code. The person scans it with the phone's camera, the phone checks over Bluetooth that it is physically near the computer, asks for Face ID or the fingerprint, and the computer is signed in. The passkey never leaves the phone.

What CropCard does to make that happen:

1. The sign-in page has a visible **Use a passkey** button. It calls `navigator.credentials.get()` in the normal (modal) mode with no `allowCredentials` list. The modal sheet is where browsers show the phone/QR option. The autofill-only (conditional) request does not reliably offer it on every browser, so the button is required, not decoration.
2. The server's login options list `hybrid` among acceptable transports and never restricts the request to platform authenticators.
3. When the login response says `authenticatorAttachment: 'cross-platform'`, the person used a phone or a security key rather than this device. The server records that on the sign-in, and the add-a-passkey card shows on this device even if the account already has passkeys (see P38-6).

**Why we do not draw our own QR code.** A home-made "scan to sign in on your computer" code, like the one some chat apps use, is a bearer link: anyone who can trick a person into scanning a code from a fake page can take over their session. That is exactly the phishing passkeys exist to stop. The browser's code is tied to Bluetooth proximity and to the real site, so a copied code is useless from far away. It also means no new token table, no polling endpoint and no extra rate limiting on our side.

**Limits we accept.**

- Both devices need Bluetooth turned on. A desktop with no Bluetooth cannot use the phone flow; the person uses the email link instead. The sign-in page's help text says so.
- Support depends on the browser and the operating system, not on us. Current Chrome, Edge and Safari on macOS and Windows support it, as do Android and iOS phones. Firefox relies on the operating system for it, and older Linux desktops may lack it. We do not try to detect support for the QR option; if the browser does not offer it, the email link is right there.
- A shared farm computer that signs in this way should not get a passkey added afterward. The add-a-passkey card always says "Only add this on your own phone or computer," and it has "Don't ask on this device" (P38-7).

## Rulings

| ID     | Ruling                                                                                                                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P38-1  | The cross-device QR code is the browser's built-in hybrid flow. CropCard shows a **Use a passkey** button that makes a modal request and never draws its own QR or sign-in-by-scan link.                                                                                                                                                                       |
| P38-2  | Passkeys are an extra way to sign in and never the only one. Email link and code, and SMS code, stay on every sign-in screen.                                                                                                                                                                                                                                  |
| P38-3  | The relying party ID is `cropcard.io` (the registrable domain), so passkeys keep working if the app moves between `app.`, `www.` or the apex. Expected origins are `ORIGIN` plus each `REDIRECT_HOSTS` origin. Dev uses `localhost`. The bare Container Apps hostname is not supported; a person there uses email.                                             |
| P38-4  | `userVerification: 'required'` on both registration and login, so a passkey always needs Face ID, a fingerprint or the device PIN. `residentKey: 'required'`, so the passkey carries the account and autofill works without typing.                                                                                                                            |
| P38-5  | Adding a passkey needs a cookie session whose sign-in proof is less than 10 minutes old (a new `proofAt` in the session payload, set by `startSession`, kept on re-mint). Bearer tokens, impersonation, partial sessions of demo users and any older session are refused with 403 `REAUTH_REQUIRED`, which the UI turns into "Sign in again to add a passkey." |
| P38-6  | The add-a-passkey card shows after a sign-in when the device supports a platform passkey and either (a) the sign-in was by email or SMS, or (b) it was by a passkey with `authenticatorAttachment: 'cross-platform'`. It never shows after a sign-in with a passkey held on this device.                                                                       |
| P38-7  | "Not now" hides the card for that sign-in. After two "Not now" taps on one device, the card adds **Don't ask on this device**, kept in localStorage (wrapped in try/catch) under the user id. The server keeps no record of dismissals, because the server cannot tell devices apart.                                                                          |
| P38-8  | Demo users and demo farms cannot add passkeys. The registration endpoints go into `DEMO_BLOCKED_WRITES`, and the card is hidden for them.                                                                                                                                                                                                                      |
| P38-9  | Passkeys belong to the person (user level), not a farm. The `passkeys` table is not `tenantScoped`; every query calls `unscopedQueryNote('passkeys are identity-level')`, like `login_tokens`.                                                                                                                                                                 |
| P38-10 | Removing a passkey on /settings/account deletes the row and does not end sessions. "Sign out everywhere" ends sessions and leaves passkeys alone. A person who thinks a device was stolen does both; /settings/account says so beside the list.                                                                                                                |
| P38-11 | The sign counter is stored and logged but never enforced, because synced passkeys report 0.                                                                                                                                                                                                                                                                    |
| P38-12 | Login options and verify are rate-limited per IP with the magic link's buckets (`ipRateBucket`), and a failed verify answers one generic message that never says whether a credential or account exists.                                                                                                                                                       |
| P38-13 | A passkey sign-in counts as a sign-in for the operator usage report and for `users.last_seen_at`, and appears in its own column ("passkey") beside email and SMS.                                                                                                                                                                                              |
| P38-14 | Helper invites still need a verified email. A passkey sign-in does not redeem an invite on its own; the invite page asks for the email link as it does now.                                                                                                                                                                                                    |
| P38-15 | Signing in by passkey does not change what a session may do. Owner-only and high-risk actions (hold voids, identity changes) keep their current checks. A passkey step-up for those is out of scope.                                                                                                                                                           |

## Data

Migration 0098 `passkeys`:

| Column          | Type    | Notes                                                                                                |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `id`            | text PK | `pk_<uuid>`                                                                                          |
| `user_id`       | text    | FK to `users`, cascade delete, indexed                                                               |
| `credential_id` | text    | base64url, unique                                                                                    |
| `public_key`    | blob    | COSE key                                                                                             |
| `sign_count`    | integer | P38-11                                                                                               |
| `transports`    | text    | JSON list from the browser                                                                           |
| `aaguid`        | text    | used only to suggest a name ("iCloud Keychain", "Google Password Manager") from a small built-in map |
| `backed_up`     | integer | 1 when the passkey is synced                                                                         |
| `name`          | text    | editable by the person, starts as the suggested name or "Passkey"                                    |
| `created_at`    | integer |                                                                                                      |
| `last_used_at`  | integer |                                                                                                      |

Challenges are not stored in a table. The options endpoint puts the challenge in a short-lived, HMAC-signed, `HttpOnly`, `SameSite=Strict` cookie (`cc_wa`, 5 minutes, signed with the session secret), and verify clears it. Each challenge is single use because verify clears the cookie, and a replayed response fails the challenge check.

The session payload gains `proofAt` (P38-5) and `via: 'email' | 'sms' | 'passkey' | 'passkey-cross'`. Old cookies without them read as a proof older than 10 minutes and `via: 'email'`, so they still work and simply cannot add a passkey until the next sign-in.

The GDPR export moves to 1.8.0 with a `passkeys` section (name, created, last used, synced or not; never the public key or credential id). Deleting an account deletes its passkeys through the cascade. A farm wipe does not touch them (P38-9).

## Server

New `lib/server/passkeys.ts` on `@simplewebauthn/server`:

- `registrationOptions(user)`: excludes the user's existing credentials, `residentKey: 'required'`, `userVerification: 'required'`, `attestationType: 'none'`, `user.name` set to `identityLabel()`.
- `verifyRegistration(user, response)`: stores the row, suggests a name from the AAGUID map.
- `loginOptions()`: no `allowCredentials`, `userVerification: 'required'`.
- `verifyLogin(response)`: finds the row by credential id, verifies against expected origins and RP ID, updates `sign_count` and `last_used_at`, loads the user and calls `startSession` with `via` set from `authenticatorAttachment`.

Routes, all with Zod schemas in a client-safe `lib/auth/apiSchemas.ts` and entries in `static/openapi.json`:

| Route                                     | Who                             | Notes                                                                    |
| ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/auth/passkey/register/options` | signed-in cookie session, P38-5 | added to the partial-session paths, so someone in onboarding can add one |
| `POST /api/auth/passkey/register/verify`  | same                            |                                                                          |
| `POST /api/auth/passkey/login/options`    | public                          | rate-limited, P38-12                                                     |
| `POST /api/auth/passkey/login/verify`     | public                          | answers `{ next }` from `LoginResult`                                    |
| `GET /api/account/passkeys`               | cookie session                  | list for /settings/account                                               |
| `PATCH /api/account/passkeys/[id]`        | cookie session, own rows only   | rename                                                                   |
| `DELETE /api/account/passkeys/[id]`       | cookie session, own rows only   | another person's id answers 404                                          |

The login endpoints join the cross-site form guard's allowlist only if the browser's fetch needs it; they are JSON endpoints called from our own page, so `formCsrfForbidden` should not apply.

## Client

- `lib/client/passkey.ts` on `@simplewebauthn/browser`: `startConditionalLogin()`, `loginWithButton()`, `addPasskey()` and `canAddPasskey()`. Each catches `NotAllowedError` (the person cancelled) silently and maps other failures to translated messages.
- Sign-in page (`/` and `/signin`): the Email field gets `autocomplete="username webauthn"`; the page starts the conditional request on mount and aborts it when the person submits the email form. A **Use a passkey** button sits above "Email me a sign-in link." The phone variant (`/?via=phone`) gets the same button.
- `components/auth/AddPasskeyCard.svelte` on /today and the onboarding first screen, driven by `via` from the layout data and P38-6/P38-7. It is held back while any `role="alert"` banner or safety stop is on screen, like the alpha welcome.
- /settings/account gains a Passkeys section: list, rename, remove, **Add a passkey on this device**, and the P38-10 note.

All new text ships in English and Spanish in `lib/i18n/catalogs/{en,es}/auth.ts` (Invariant 9). The browser's own passkey sheets are in the browser's language and are not ours to translate.

## Tests

- Unit: options and verify against recorded registration and login responses (one platform, one cross-platform, one with a bad origin, one replayed challenge, one expired challenge cookie, one unknown credential); P38-5 refusals; P38-6 card rules as a pure function; demo refusal; rename and delete of another person's passkey answer 404.
- Session: old cookies without `proofAt` or `via` still sign in, and "Sign out everywhere" ends a passkey session.
- e2e (Chromium): Playwright's CDP virtual authenticator for add a passkey after an email sign-in, sign out, sign in by autofill, sign in by the button, remove from settings, and the cross-platform path (a virtual authenticator with `transport: 'hybrid'`, which checks that the card offers a passkey on this device afterward). The real QR scan cannot be automated and goes on the owner's device test list.
- Export: `passkeys` in GDPR export 1.8.0 with no key material.

## Owner device test list

1. iPhone Safari: add a passkey after an email sign-in, sign out, sign back in by autofill.
2. Android Chrome: the same.
3. A Windows or Mac computer with no passkey: **Use a passkey**, scan the QR with the iPhone, confirm sign-in, then accept the card to add a passkey on the computer.
4. The same with Bluetooth off on the computer: confirm the email link still works and the help text makes sense.
5. Gloves on: Face ID and the device PIN work where a fingerprint reader does not.

## Out of scope

- A home-made QR or sign-in-by-scan code (P38-1).
- Passkeys as a step-up check for hold voids, identity changes or billing (P38-15).
- Passkey-only accounts with no email or phone.
- Hardware security key management beyond what WebAuthn already does (they work, and are listed like any other passkey).

## Size

One focused phase in two clusters that can run in parallel worktrees once the migration and session fields land in a foundations commit: (A) server, migration, export and unit tests; (B) sign-in page, card, settings, catalogs and e2e. Adds two dependencies, `@simplewebauthn/server` and `@simplewebauthn/browser`. No safety-rule change; `RULES_VERSION` stays 0.7.11. /today gains no query, because `via` rides in the session cookie.
