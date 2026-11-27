# Phase 38: beginner growers, a how-to-start guide, soil survey and Find a spot

Owner request, 2026-11-27: help beginner farmers with tips as they go, add a "how to start",
rewrite the landing page for novice and experienced growers of garden and row crops, and help
the grower choose a good place to plant using an aerial view, sun, trees and soil data.

## Owner rulings (2026-11-27)

| #    | Ruling                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1  | Claude reads USDA NAIP aerial imagery (public domain, fetched on the server from the USGS National Map image service). Esri World Imagery tiles stay display-only and are never sent to an AI service.                   |
| O-2  | Soil data is its own module (`lib/soil`, USDA NRCS Soil Data Access / SSURGO), shown wherever it helps. It is survey data tagged `data`, never replaces a lab soil test and is never read by safety or fertility math.   |
| O-3  | The aerial analysis is on every plan with a small daily cap (Free 1, Grower 5, Farm 10) drawn from the general monthly AI budget. Without AI the finder still works from sun math, drawn shade sources and soil data.    |
| O-4  | Beginner material is a public `/start` guide linked from the landing page, plus a "first time growing?" question in onboarding that turns on per-screen tips, switchable in settings.                                    |

## Clusters (one PR each, merged in this order)

| Cluster | What                                                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38A     | Landing page rewrite in plain English for gardens, fields, animals and records; public `/start` guide with a garden track, a fields track and a plain-English word list.                                                                  |
| 38B     | Beginner tips: per-user `users.beginner_tips` (migration 0098), onboarding question, `BeginnerTip` inline card on each main screen (seen state through the hints store, keys `tip_*`), settings switch and reset, Getting Started item. |
| 38C     | Soil survey module: SSURGO lookup by point with a global cache, plain-English description, siting flags, `/api/soil/**`, a lazy panel on Area Cards, /fertility and /settings/farm.                                                       |
| 38D     | Find a spot (`/plan/site-finder`): deterministic scoring from sun position, drawn shade sources, existing Areas, water and soil; optional Claude reading of a NAIP aerial photo through `aiTry()` + `aiGuard` (endpoint `site-finder`).   |

## Design rulings

| #    | Ruling                                                                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Guide and tip copy gives process advice only. No rates, distances, day counts, hours, temperatures, pH targets or product names; pesticide mentions say to follow the label. Never the word "safe" as a claim.                                                           |
| P-2  | Tips are per user, not per farm. NULL means never asked and reads as off, so existing users and seeded test users see no change. The throwaway demo visitor gets tips on.                                                                                               |
| P-3  | A tip is an inline card that never covers controls, hides while a safety stop is on screen and is shown one teaching element at a time (an anchored Hint waits for the tip).                                                                                            |
| P-4  | Soil survey is online only. It is not in the offline snapshot, so `FARM_SNAPSHOT_VERSION` does not change. "No data here" and "could not reach the service" are different states and are never conflated.                                                               |
| P-5  | Soil siting flags come from NRCS's own classes (drainage, flooding, hydric) plus named app-owned slope and depth thresholds, shown as a rough guide.                                                                                                                    |
| P-6  | Find a spot scores are an app-owned rough guide tagged `fallback`; survey facts are `data`; anything Claude saw in the photo is `ai` and is a suggestion until the owner confirms it (a tree Claude saw becomes a shade source only when the owner adds it).             |
| P-7  | Claude's reading of the photo is validated on the server: positions inside the photo, a capped count, text through the spray-advice guard. An invalid answer falls back to the deterministic result tagged `fallback`. Claude never names a product or gives a rate.    |
| P-8  | Find a spot never gates anything and never feeds the safety kernel. It ends in "Create this Area here", which uses the existing Area endpoints (owner only; helpers read and see "Ask the owner").                                                                       |
| P-9  | No safety-rule change; `RULES_VERSION` unchanged.                                                                                                                                                                                                                      |

As-built notes per cluster are added below as each PR lands.
