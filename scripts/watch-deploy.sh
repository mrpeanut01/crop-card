#!/usr/bin/env bash
#
# Follow a merge until it is actually serving in production, then print the
# LIVE banner. Exits non-zero (with the reason) if CI or the deploy fails.
#
#   ./scripts/watch-deploy.sh              # the current head of origin/main
#   ./scripts/watch-deploy.sh 396          # a PR number: waits for it to merge first
#   ./scripts/watch-deploy.sh c08d0d3...   # a commit on main
#
# "Live" means production's /api/health reports this commit (or a newer main
# commit that contains it) as `version`,
# not that a workflow went green. Needs `gh auth login` and curl.

set -euo pipefail

REPO="${CROPCARD_REPO:-mrpeanut01/crop-card}"
ARG="${1:-}"
PR=""
TITLE=""

log() { printf '[watch-deploy] %s\n' "$*" >&2; }

if [[ "$ARG" =~ ^[0-9]{1,6}$ ]]; then
  PR="$ARG"
  log "waiting for PR #${PR} to merge"
  while :; do
    read -r STATE MERGE_SHA < <(gh pr view "$PR" --repo "$REPO" \
      --json state,mergeCommit -q '"\(.state) \(.mergeCommit.oid // "-")"')
    [ "$STATE" = MERGED ] && { SHA="$MERGE_SHA"; break; }
    [ "$STATE" = CLOSED ] && { log "PR #${PR} was closed without merging"; exit 1; }
    sleep 20
  done
  TITLE="$(gh pr view "$PR" --repo "$REPO" --json title -q .title)"
elif [ -n "$ARG" ]; then
  SHA="$(gh api "repos/${REPO}/commits/${ARG}" -q .sha)"
else
  SHA="$(gh api "repos/${REPO}/commits/main" -q .sha)"
fi
if [ -z "$PR" ]; then
  PR="$(gh api "repos/${REPO}/commits/${SHA}/pulls" -q '.[0].number // empty' 2>/dev/null || true)"
  [ -n "$PR" ] && TITLE="$(gh pr view "$PR" --repo "$REPO" --json title -q .title)"
fi
SHORT="${SHA::7}"
log "commit ${SHORT}${PR:+ (PR #${PR})}"

# Wait for a workflow run on this commit to exist, then follow it to the end.
follow() { # workflow-file event
  local id=""
  for _ in $(seq 1 60); do
    id="$(gh run list --repo "$REPO" --workflow "$1" --event "$2" --limit 20 \
      --json databaseId,headSha -q "[.[] | select(.headSha == \"${SHA}\")][0].databaseId // empty")"
    [ -n "$id" ] && break
    sleep 10
  done
  [ -n "$id" ] || { log "no $1 run for ${SHORT} after 10 minutes"; return 1; }
  log "following $1 run ${id}"
  gh run watch "$id" --repo "$REPO" --exit-status --interval 20 >/dev/null ||
    { log "$1 failed: https://github.com/${REPO}/actions/runs/${id}"; return 1; }
}

follow ci.yml push
CI_DONE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Deploy runs are triggered by workflow_run and queue one at a time, and
# GitHub labels each with main's newest commit, not the commit it deploys, so
# following "the deploy run for this SHA" can pick the wrong one. Instead,
# poll production until it serves this commit or a newer main commit that
# contains it, and fail fast if a deploy run fails in the meantime.
ORIGIN=""
for DEP in $(gh api "repos/${REPO}/deployments?environment=production&per_page=10" -q '.[].id'); do
  ORIGIN="$(gh api "repos/${REPO}/deployments/${DEP}/statuses" \
    -q '[.[] | select(.environment_url != "")][0].environment_url // empty')"
  [ -n "$ORIGIN" ] && break
done
[ -n "$ORIGIN" ] || { log "no production deployment URL recorded"; exit 1; }
log "waiting for ${ORIGIN} to serve ${SHORT}"

contains() { # live-sha: true when live is SHA or a descendant of it
  [ "$1" = "$SHA" ] && return 0
  local st
  st="$(gh api "repos/${REPO}/compare/${SHA}...${1}" -q .status 2>/dev/null || true)"
  [ "$st" = ahead ] || [ "$st" = identical ]
}

LIVE=""
for _ in $(seq 1 90); do # 30 minutes
  # The app scales to zero, so a request may wait on a cold start.
  LIVE="$(curl -fsS --max-time 90 "${ORIGIN%/}/api/health" 2>/dev/null |
    sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
  if [ -n "$LIVE" ] && contains "$LIVE"; then break; fi
  FAILED="$(gh run list --repo "$REPO" --workflow deploy.yml --limit 10 \
    --json databaseId,conclusion,createdAt \
    -q "[.[] | select(.createdAt >= \"${CI_DONE}\" and (.conclusion == \"failure\" or .conclusion == \"timed_out\"))][0].databaseId // empty")"
  if [ -n "$FAILED" ]; then
    log "a deploy failed while waiting: https://github.com/${REPO}/actions/runs/${FAILED}"
    exit 1
  fi
  LIVE=""
  sleep 20
done
if [ -z "$LIVE" ]; then
  log "${ORIGIN} did not serve ${SHORT} within 30 minutes"
  exit 1
fi
VIA=""
[ "$LIVE" != "$SHA" ] && VIA=" (via ${LIVE::7})"

line() { printf '║  %-61s║\n' "$1"; }
echo "╔═══════════════════════════════════════════════════════════════╗"
line "✅  LIVE IN PRODUCTION"
line "${SHORT}${PR:+ · PR #${PR}}${VIA}"
[ -n "$TITLE" ] && line "${TITLE:0:61}"
line "${ORIGIN}"
echo "╚═══════════════════════════════════════════════════════════════╝"
