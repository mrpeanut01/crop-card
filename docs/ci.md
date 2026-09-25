# CI, security and release checks

The pipeline is sized for a single-farm field app. Every pull request gets the checks that catch real regressions quickly, and the slower or noisier checks wait for a merge, a weekly run or a release.

## On every pull request (`ci.yml`)

These jobs run in parallel and usually finish in a few minutes. Branch protection only needs to require the `test` job, which passes when all of them pass.

| Job | What it protects |
|---|---|
| typecheck + lint + audit | Strict TypeScript, ESLint including the tenant-isolation rule, OpenAPI drift, and a block on high or critical advisories in production dependencies |
| unit tests | The safety kernel (with its fast-check properties), tenant isolation, and server logic |
| e2e | Sign-in, the plan wizard, the spray and plan shells, and no horizontal overflow at 375px |
| validate-bicep | The Azure template still builds |
| dependency review | A PR can't add a dependency with a known high-severity advisory. Runs once the Dependency graph is enabled and the repo variable `DEPENDENCY_REVIEW=true` is set |

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

`deploy.yml` runs when `ci` succeeds on a push to `main`: it builds the image on the runner, pushes it to the resource group's ACR, deploys `infra/azure/main.bicep`, and waits until `/api/health` reports the deployed commit as `version` (baked into the image as `BUILD_SHA`); the deploy step itself is `scripts/deploy-azure.sh --apply --ci`, the same script used by hand. `scripts/watch-deploy.sh <pr>` follows a merge to that point and prints a LIVE banner. It authenticates with GitHub OIDC through the `production` environment (main only), so GitHub holds no Azure credentials, and app secrets never leave Key Vault. One-time setup is `scripts/setup-github-deploy.sh`; `scripts/deploy-azure.sh --apply` remains the local path and the bootstrap for a fresh resource group.

## On demand

- **AI review of a PR:** add the `claude-review` label. The review is advisory, posts comments, and removes the label when it finishes so it can be re-applied.
- **Visual screenshots (`visual.yml`):** run from the Actions tab before merging a visual redesign. Set `update` to re-capture the Linux baselines on the runner and commit them to the chosen branch. These comparisons used to run on every PR; they were moved here because the layout guarantee that matters is already an e2e assertion, and keeping pixel baselines in step with every UI change cost more than it caught.

## Dependency updates

Dependabot opens grouped weekly PRs for npm minor and patch updates, and monthly PRs for GitHub Actions and the Docker base image. Security updates arrive on their own as soon as an advisory is published.
