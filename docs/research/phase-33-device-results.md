# Phase 33 R7: device and browser results

Only the desktop part could be run (2026-10-01). **Not run:** HEIC uploads, Safari on macOS, Safari on iPhone, Chrome on Android, Chrome desktop outside the Claude app, direct-open tabs and Firefox. They need real devices and a person to pick photos.

## Sandbox CSP (desktop Chromium)

Test server sent `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff`, with `Content-Disposition` inline and attachment. Browser: Chromium 152 inside the Claude desktop app (Electron), macOS, 2026-10-01. No console messages.

| Resource | Disposition | Embed                             | Result                                             |
| -------- | ----------- | --------------------------------- | -------------------------------------------------- |
| PNG      | inline      | `<img>` same origin               | renders (8x8)                                      |
| PNG      | attachment  | `<img>` same origin               | renders                                            |
| PDF      | inline      | `<iframe>`                        | built-in viewer renders                            |
| PDF      | inline      | `<object type="application/pdf">` | built-in viewer renders                            |
| PDF      | attachment  | `<iframe>`                        | blank frame (download is triggered, nothing shown) |

Caveats: Electron's PDF viewer may differ from stock Chrome, Safari and Firefox, which is the open question this task was meant to answer. Re-run on those before relying on inline PDFs.

## HEIC

Not tested. Needs an iPhone HEIC photo through the journal and animal photo pickers on iOS Safari, Android Chrome and desktop Safari.
