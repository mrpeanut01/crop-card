# CI, security and release checks

The pipeline is sized for a single-farm field app. Every pull request gets the checks that catch real regressions quickly, and the slower or noisier checks wait for a merge, a weekly run or a release.

## On every pull request (`ci.yml`)

These jobs run in parallel and usually finish in a few minutes. Branch protection only needs to require the `test` job, which passes when all of them pass.

| Job                      | What it protects                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck + lint + audit | Strict TypeScript, ESLint including the tenant-isolation rule, OpenAPI drift, and a block on high or critical advisories in production dependencies              |
| unit tests               | The safety kernel (with its fast-check properties), tenant isolation, and server logic                                                                           |
| e2e                      | Sign-in, the plan wizard, the spray and plan shells, and no horizontal overflow at 375px                                                                         |
| validate-bicep           | The Azure template still builds                                                                                                                                  |
| dependency review        | A PR can't add a dependency with a known high-severity advisory. Runs once the Dependency graph is enabled and the repo variable `DEPENDENCY_REVIEW=true` is set |

A new push to the same PR cancels the run already in progress.

## After merge and weekly (`security.yml`)

CodeQL (security-extended queries) and a wider dependency audit that includes dev dependencies. Results go to the repository's Security tab. GitHub's own secret scanning and Dependabot alerts are on by default for this public repo, so nothing extra runs for those.

## On each release (`release.yml`)

Push a semver tag to cut a release:

```sh
git tag v1.2.3 && git push origin v1.2.3
```

The release workflow then runs:

1. The full PR gate and the security workflow, against the tagged commit.
2. A container image build from `infra/Dockerfile`, scanned with Trivy. A fixable critical vulnerability fails the release; high findings are reported.
3. An SBOM of the image in SPDX format.
4. A Claude code and security review of every change since the previous tag, measured against the invariants in `CLAUDE.md`. It needs the `ANTHROPIC_API_KEY` repository secret and is skipped (not failed) without it.
5. A GitHub Release with generated notes and the SBOM, scan report and review attached.

## Deploy

`deploy.yml` runs when `ci` succeeds on a push to `main`: it builds the image on the runner, pushes it to the resource group's ACR, deploys `infra/azure/main.bicep`, and waits until `/api/health` reports the deployed commit as `version` (baked into the image as `BUILD_SHA`); the deploy step itself is `scripts/deploy-azure.sh --apply --ci`, the same script used by hand. `scripts/watch-deploy.sh <pr>` follows a merge to that point and prints a LIVE banner. It authenticates with GitHub OIDC through the `production` environment (main only), so GitHub holds no Azure credentials, and app secrets never leave Key Vault. One-time setup is `scripts/setup-github-deploy.sh`; `scripts/deploy-azure.sh --apply` remains the local path and the bootstrap for a fresh resource group. Optional features are switched on by which secret names the vault holds (the CI identity only lists names): Pingram or Postmark mail, the Anthropic key, Stripe billing (`stripe-secret-key`, `stripe-webhook-secret` and the four `stripe-price-{grower,farm}-{monthly,annual}` ids) and Web Push (`vapid-public-key` plus `vapid-private-key`, only as a pair). `scripts/set-azure-secret.sh` stores each one; the deploy log prints which are on.

## On demand

- **AI review of a PR:** add the `claude-review` label. The review is advisory, posts comments, and removes the label when it finishes so it can be re-applied.
- **Visual screenshots (`visual.yml`):** run from the Actions tab before merging a visual redesign. These comparisons used to run on every PR; they were moved here because the layout guarantee that matters is already an e2e assertion, and keeping pixel baselines in step with every UI change cost more than it caught. Linux (`*-linux.png`, CI Chromium) is the only committed baseline set; `*-darwin.png` is gitignored, and baselines are never captured on a laptop.

  **Re-capturing the Linux baselines after a UI change merges** (Phase 33D, rulings D-37 and D-38):

  1. Cut a branch from the updated `main`, for example `git switch -c visual/rebaseline-20261002 origin/main && git push -u origin HEAD`.
  2. Dispatch the workflow from it with `update` on: `gh workflow run visual.yml --ref visual/rebaseline-20261002 -f update=true`, or in the Actions tab pick **visual**, **Run workflow**, choose the branch under **Use workflow from**, leave the branch field blank and tick **update**. A blank branch field means the branch the run was dispatched from; fill it in only to test a different branch.
  3. When the run finishes it has committed `test(visual): re-capture Linux baselines on CI Chromium` to that branch. Open each changed `-linux.png` and check it by eye: the page is the current one, nothing that moves with the date, weather or seed shows through a mask, and nothing is cut off.
  4. Open a PR from the branch. The bot's commit is pushed with the workflow's `GITHUB_TOKEN`, and GitHub starts no workflows for such pushes, so CI does not run on it. Push one ordinary commit on top (merging `main` into the branch is enough) to start CI; after that it auto-merges once CI is green like any other.
  5. Optional check: dispatch again on `main` with `update` off; it should pass.

  Dispatching with `update` on against `main` (from `main` with the field blank, or with `main` typed in) fails at its first step on purpose: `main` is protected and only takes pull requests, so the commit would be refused after a full run. Use a branch and a PR. Locally, `E2E_VISUAL=1 pnpm --filter @cropcard/web exec playwright test tests/e2e/visual --update-snapshots=none` is only useful to check that a spec reaches its screenshot; a pixel mismatch there is expected, and no PNG from it is committed.

## Dependency updates

Dependabot opens grouped weekly PRs for npm minor and patch updates, and monthly PRs for GitHub Actions and the Docker base image. Security updates arrive on their own as soon as an advisory is published.
