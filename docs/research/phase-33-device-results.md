# Phase 33 R7 and #572: device and browser results

Two passes so far. The first (2026-10-01) checked desktop PDF and image viewing in one Chromium. The second (2026-10-05, #572) ran everything that does not need a physical phone across three engines and two phone emulations. What still needs a person with real hardware is listed at the end.

## 2026-10-05 sweep (#572)

**Setup.** macOS 27.2 (Apple silicon), Playwright 1.63.0 with Chromium 153.0.8010.12, WebKit 26.6 and Firefox 155.0. Five projects: desktop Chromium, desktop WebKit (Safari's engine), desktop Firefox, `iPhone 15` (WebKit, 393x659, touch, mobile UA) and `Pixel 7` (Chromium, 412x839, touch, Android UA). The server was the hermetic e2e build (direct sign-in, filesystem vault, 21 MB body limit, seeded fixtures plus the Willow Run demo farm), started by hand on port 5390. The specs are in `apps/web/tests/device/` and run with `playwright.devices.config.ts`; that config's header says how. They are not in CI: the offline spec needs the signal proxy, the HEIC result depends on the host, and the demo farm allows six starts per IP in ten minutes. The CI-safe part of the HEIC fix is `tests/e2e/heic-photos.spec.ts`.

**Limits of emulation.** Playwright's iPhone project is the macOS WebKit build with an iPhone viewport, user agent and touch. It is not iOS. It does not show the iOS photo picker, the iOS print sheet, Home Screen installs, push, or iOS form-control rendering. The Pixel project is desktop Chromium with Android emulation, for the same reasons.

### 1. Document vault viewing (sandbox CSP)

The file route sends `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. Images are served `inline`; PDFs and CSVs are served as `attachment` (`contentDisposition` in `lib/server/documentAccess.ts`). Test files: a 400 px PNG, a 400 px JPEG and a 62 KB one-page PDF made with `sips`.

| Check                                            | Chromium              | WebKit                       | Firefox               | iPhone (WebKit)              | Pixel (Chromium)      |
| ------------------------------------------------ | --------------------- | ---------------------------- | --------------------- | ---------------------------- | --------------------- |
| PNG and JPEG in an `<img>` on an app page        | renders (400 px)      | renders                      | renders               | renders                      | renders               |
| PNG and JPEG opened in a new tab                 | renders               | renders                      | renders               | renders                      | renders               |
| PDF via the Open link                            | download `report.pdf` | download `report.pdf`        | download `report.pdf` | download `report.pdf`        | download `report.pdf` |
| PDF (attachment) in an `<iframe>` on an app page | empty frame           | frame not readable (sandbox) | empty frame           | frame not readable (sandbox) | empty frame           |
| Console errors                                   | none                  | none                         | none                  | none                         | none                  |

Every engine gives the same result: images display, and a PDF always downloads with the right name and every byte. Nothing in the app embeds a vault PDF, so the empty frame changes nothing. On a real iPhone, Safari shows its own "download or view" prompt for an attachment; that prompt can't be emulated and is on the human checklist.

### 2. HEIC through the photo pickers

A real HEIC (`sips -s format heic`, 1200x900, `ftypheic`/`mif1`) was set on the journal picker (Care Guide "Ask about a photo"), the animal photo picker, the profile picture picker and the document vault upload.

| Path                               | Chromium / Pixel / Firefox (before) | Chromium / Pixel / Firefox (after)                                       | WebKit / iPhone                                                  |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Engine decodes HEIC                | no (`InvalidStateError`)            | no                                                                       | yes, 1200x900                                                    |
| Journal photo                      | "That photo could not be read."     | HEIC message (below)                                                     | saved; the phone sent a JPEG data URL and the server serves JPEG |
| Animal photo                       | "That photo could not be read."     | HEIC message                                                             | saved, JPEG                                                      |
| Profile picture                    | "couldn't be read as a picture"     | HEIC message                                                             | saved, JPEG                                                      |
| Vault upload in the app            | bare "can't be stored" type list    | "HEIC photos can't be stored. Save it as a JPEG or PDF and upload that." | same message                                                     |
| Vault upload, raw bytes to the API | 415 `UNSUPPORTED_TYPE`              | 415 `UNSUPPORTED_TYPE` (unchanged)                                       | 415 `UNSUPPORTED_TYPE`                                           |

**What the server does with HEIC:** it never receives one from a photo picker, because the pickers decode the file on the device and send a re-encoded JPEG with no EXIF. The vault types files from their bytes and refuses HEIC with 415. Nothing converts HEIC on the server.

**Would a real iPhone user be refused?** No. WebKit decodes HEIC, so the photo saves either way. iOS can also hand over a JPEG before the page sees the file: WebKit transcodes a picked HEIC to the first acceptable type when `accept` lists explicit types ([WebKit bug 292350](https://bugs.webkit.org/show_bug.cgi?id=292350), fixed 2026-02-18), and the iOS 17 picker's "Automatic" setting converts even with `accept="image/*"` ([Apple forum 743037](https://developer.apple.com/forums/thread/743037)). The people who hit the old dead end are Chrome or Firefox users holding a HEIC file: an iPhone photo copied to a Windows PC, or an Android phone set to HEIF.

**Panel ruling (2026-10-05).** Three panelists (farmer and field user, data integrity and security, precedent and engineering) each read primary sources: [caniuse HEIF](https://caniuse.com/heif), WebKit 292350, [Apple forum 743049](https://developer.apple.com/forums/thread/743049), [sharp install docs](https://sharp.pixelplumbing.com/install) and the [Debian libheif CVE tracker](https://security-tracker.debian.org/tracker/source-package/libheif).

| #   | Question                                                                   | Farmer | Data integrity | Engineering | Ruling                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------- | ------ | -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 | When the browser can't decode a HEIC, show a specific message in en and es | Yes    | Yes            | Yes         | 3-0. Detect HEIC only after the decode fails (by type, a `.heic`/`.heif` name or the `ftyp` brand, `lib/photoFormat.ts`), throw `PhotoHeicError` from `resizePhoto`, and say how to get a JPEG. Safari never sees the message. Truly unreadable files keep the generic one.        |
| H-2 | Drop `image/heic,image/heif` from the profile picture's `accept`           | Yes    | Yes            | Yes         | 3-0. Listing HEIC gains nothing (Chrome and Firefox can't decode it) and, per forum 743049, makes Safari 17+ convert picked JPEG/PNG files to HEIC. Now `image/jpeg,image/png,image/webp`, JPEG first so Safari transcodes to JPEG.                                                |
| H-3 | Add server-side HEIC decoding (sharp/libheif)                              | No     | No             | No          | 3-0. sharp's prebuilt binaries can't decode HEVC HEIC, libheif has a steady CVE record, HEVC is patent-encumbered, and decoding would run on the single 0.5 vCPU replica that holds the database. No iPhone path needs it. Revisit only if #466 feedback shows real HEIC failures. |
| H-4 | Keep the vault's 415 for HEIC                                              | Yes    | Yes            | Yes         | 3-0. Vault files are compliance evidence: a converted file isn't the original, and the vault has no HEIC metadata stripper. Two panelists asked for a plain HEIC message on the 415; the client now shows one.                                                                     |

### 3. Offline Cards, pinning and `/c/<key>` short links

The real service worker was used (`serviceWorkers: 'allow'`). "No signal" was simulated two ways.

- **Playwright `context.setOffline(true)`.** This is what `tests/e2e/offline-cards.spec.ts` and `record-cards-offline.spec.ts` use on Chromium in CI. In WebKit every navigation failed with "WebKit encountered an internal error" before the service worker could answer. In Firefox it failed with `NS_ERROR_OFFLINE` (Firefox's Work Offline mode bypasses the worker for navigations). These are emulation artifacts, not app bugs. A phone with no signal still runs its service worker, as the next method shows.
- **A TCP proxy that drops every connection** (`tests/device/signal-proxy.mjs`). The browser keeps `navigator.onLine === true` (lie-fi), so this is the harder case.

| Check (proxy method, `tests/device/offline.spec.ts`)                                          | Chromium | WebKit | Firefox | iPhone | Pixel |
| --------------------------------------------------------------------------------------------- | -------- | ------ | ------- | ------ | ----- |
| `/cards` deck opens with no signal                                                            | pass     | pass   | pass    | pass   | pass  |
| A planting card never opened online opens by hard navigation                                  | pass     | pass   | pass    | pass   | pass  |
| That card in print media shows one print card, buttons hidden                                 | pass     | pass   | pass    | pass   | pass  |
| `/c/<pl_key>` short link resolves to the card offline                                         | pass     | pass   | pass    | pass   | pass  |
| Pinned spray record card opens from `/c/rc_spray.<id>` as a saved copy, no overflow at 375 px | pass     | pass   | pass    | pass   | pass  |

**Bug found and fixed: pinning in Firefox.** Online, the Pin button on `/cards` did nothing visible in Firefox: after `pinCard` it awaited `navigator.storage.persist()` before updating the list, and Firefox answers `persist()` only after the person replies to its permission prompt. The pin now shows at once and the persistence request runs in the background (`OfflineCards.togglePin`/`pinAll`, unit test `offlineCards.svelte.test.ts`). After the fix the existing pinning e2e passes on Chromium, WebKit and Firefox. Record-card pins already did this.

### 4. Printing

Print media was emulated in all three engines on the demo farm. `page.pdf({ preferCSSPageSize: true })` was used in Chromium (WebKit and Firefox in Playwright can't produce a PDF, so they got print-media screenshots). A script listed every element with text or a figure that ends outside its sheet page or print cell (both are `overflow: hidden`).

| Card                                      | Paper (Chromium PDF)    | Pages | Clipped content                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Week Card                                 | 11 x 8.5 in (landscape) | 1     | none                                                                                                                                                                                                                                 |
| Month Card                                | 11 x 8.5 in (landscape) | 1     | none                                                                                                                                                                                                                                 |
| Spray Card, 4x6 index (default)           | 6 x 4 in                | 1     | After the decon-first steps and "Before you spray", the EPA number, rate, tank, REI, PHI and mix order fade out. A "RATE" label prints without its value. "Cut short? The label and the live card have the full directions." prints. |
| Spray Card, 3x5 index                     | 5 x 3 in                | 1     | Most facts and the mix order, as above                                                                                                                                                                                               |
| Spray Card, Letter 4-up                   | 8.5 x 11 in             | 1     | PHI, next step and mix order                                                                                                                                                                                                         |
| Farm Map Card                             | 8.5 x 11 in             | 1     | Lists after Gardens (orchards, pastures, barns, coops); "Cut short?" prints                                                                                                                                                          |
| Area Cards without a bed map (7)          | 6 x 4 in                | 1     | none, except a crop field with long notes                                                                                                                                                                                            |
| Area Card with a bed map (Kitchen Garden) | 8.5 x 11 in             | 1     | The "Growing now" and "Planned" lists at the bottom                                                                                                                                                                                  |

The three engines clipped the same items, so the clipping is not engine-specific. Truncation with a fade and a "Cut short?" line is the design. Two problems inside the design were fixed:

- **Farm Map Card labels overprinted.** Where Areas sit close together at the map's scale (Farmhouse, Kitchen Garden, High Tunnel, Bank Barn and Chicken Coop around the yard), their names printed on top of each other and could not be read. `lib/farm/figureLabels.ts` now gives an Area whose name would collide with one already placed a number instead, larger Areas first, and the legend under the map lists the numbers. The printed bed map already works this way. It applies on screen and in print (`FarmMapFigure`), and the legend label is in en and es (`farm.fig.numbered`).
- **The Area Card bed map printed about 1.6 in tall.** The map was capped at 1.6 in on a page given over to it so "the whole map fits". A 40x60 ft garden printed about 1 in wide, and the bed and planting labels could not be read. The print cap is now 3.5 in (`BedMapThumb`); that card always prints on its own Letter page.

**Resolved by panel ruling ([#581](https://github.com/mrpeanut01/crop-card/issues/581), 2026-10-05):** a Spray Card never fades or drops anything. On 4x6, 3x5 and Letter 4-up it prints as numbered cards ("Card N of M"), the decon SOP first when the sprayer needs it, then the rate, per-tank amount, REI, PHI and EPA number, PPE, and mix order, each fact and section whole. Rulings and tests: [`docs/design/SPRAY_CARD_PRINT.md`](../design/SPRAY_CARD_PRINT.md).

### 5. Tap targets at 375 px

Every visible link, button, input, select, summary and tab on 15 field screens of the demo farm was measured: `/today`, `/spray`, `/spray/insecticide`, `/spray/fungicide`, `/scout`, `/harvest`, `/hay`, `/fertility`, `/cards`, `/animals`, `/inventory`, `/equipment`, `/records`, `/plan` and `/calibrate`. A checkbox or file input counted as passing when its label is 48 px tall. Engines: WebKit at 375x812 and iPhone 15, plus Chromium for comparison.

Fixed (both engines):

- `/spray/fungicide`: product checkboxes were 12x12 inside rows about 24 px tall. Rows are now 48 px tall and checkboxes 24 px.
- `/spray/insecticide` "Scouting thresholds" (62 per page) and `/harvest` "Readiness indicators" (47 per page) disclosure rows were 21 px tall; they are now 48 px.
- `/fertility`: the two "Record ..." disclosure headings were 25 px tall; they are now 48 px.
- The Record button on the three spray flows (`SprayDecisionPage`) was 44 px tall; it is now 48 px.

Fixed after a panel ruling (2026-10-05, same three lenses as the #581 Spray Card panel: farmer, safety and regulatory, print and front-end engineering):

| #   | Question                                                                                                                        | Farmer | Safety | Engineering | Ruling                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | Raise `--btn-height-primary`, `--btn-height-ghost` and `--btn-height-min-tap` to 48 px, office screens included                 | Yes    | Yes    | Yes         | 3-0. The invariant is 48 dp (Material); Apple's 44 pt is a floor, not a glove size. WCAG 2.5.8 (AA) only asks 24 px and 2.5.5 (AAA) 44 px, so this is a product rule above both. One size, no exceptions.                                                                                                                                                      |
| T-2 | Fix the named sub-48 controls on /records, /plan and /inventory                                                                 | Yes    | Yes    | Yes         | 3-0. Chips keep their small pill and get a 48 px hit area from padding; neighbouring hit areas never overlap.                                                                                                                                                                                                                                                  |
| T-3 | One global `<select>` style: `appearance: none`, 48 px, a drawn chevron with room for it, `!important` only on those properties | Yes    | Yes    | Yes         | 3-0. Svelte's scoped `select.svelte-x` beats a bare `select`, so the few properties are `!important`; background colour, border and font stay with the component. The chevron is a token (`--select-chevron`, `#4a4f46` on paper, above 3:1); under `forced-colors` the native control comes back; printed selects don't grow; listboxes keep the native look. |
| T-4 | Changed visual baselines are re-captured by `visual.yml` after merge, noted in the PR, not blocking                             | Yes    | Yes    | Yes         | 3-0.                                                                                                                                                                                                                                                                                                                                                           |

One amendment did not carry (1 for, 1 against, 1 silent, so the conservative path): forcing a 16 px font on every select and input to stop iOS Safari zooming on focus. It changes type across 61 files and can't be done without `!important` on `font-size`; it needs its own look on a real iPhone.

What changed: the three tokens are 48 px (every `Button` is now 48 px); `almanac-base.css` carries the select rule; /records export links, year picker, kind chips, date inputs, "Clear dates", open-record links and the integrity links, the /plan planting tabs and "Edit season settings", the /inventory search box and Card titles (now at least 48 px wide) are 48 px. After the change the sweep finds nothing under 48 px on the 15 screens in WebKit, iPhone emulation or Chromium except the inline banner link on /harvest, which WCAG 2.5.8 exempts. Whether iOS Safari on a real iPhone draws the new selects at 48 pt is still on the hardware checklist.

Not changed:

- **Inline links in running text** (the TopBar alerts list when open, the `/harvest` forage banner link): WCAG 2.5.8 exempts them.

## 2026-10-01: sandbox CSP (desktop Chromium only)

The test server sent `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff`, with `Content-Disposition` inline and attachment. Browser: Chromium 152 inside the Claude desktop app (Electron), macOS. No console messages.

| Resource | Disposition | Embed                             | Result                                             |
| -------- | ----------- | --------------------------------- | -------------------------------------------------- |
| PNG      | inline      | `<img>` same origin               | renders (8x8)                                      |
| PNG      | attachment  | `<img>` same origin               | renders                                            |
| PDF      | inline      | `<iframe>`                        | built-in viewer renders                            |
| PDF      | inline      | `<object type="application/pdf">` | built-in viewer renders                            |
| PDF      | attachment  | `<iframe>`                        | blank frame (download is triggered, nothing shown) |

## Still needs a person and real hardware

- **iPhone (Safari and installed PWA):**
  - Add to Home Screen, then turn on push in /settings/notifications and receive a decon-due or frost alert.
  - Pick a HEIC photo from Photos in the journal, animal and profile pickers, and confirm the vault upload arrives as JPEG.
  - Open a vault PDF and see Safari's download/view prompt.
  - Open `/cards` in airplane mode, plus a pinned card and a printed `/c/` QR code.
  - Check whether `<select>` controls on `/spray/fungicide` and `/scout` are 48 pt tall.
- **Android (Chrome, installed):** push alerts, a photo from the camera and from the gallery (including a phone set to HEIF), and offline `/cards` and a `/c/` QR code in airplane mode.
- **Physical printer:** Spray Card on 4x6 and 3x5 index stock, Week and Month Cards on Letter landscape, the Farm Map Card and an Area Card bed map on Letter, from iPhone (Share → Print), Android and desktop. Check margins, cut lines and that nothing is cut off at the printer's hardware margins.
- **Glove test in the field:** record a spray, a scout observation and a harvest wearing work gloves on a phone in sun, and note any control that takes more than one try.
