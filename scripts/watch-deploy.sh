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
#
# One exception: when a proxy refuses the tunnel to production (Claude Code
# cloud sessions do), this machine cannot ask /api/health itself, so it
# follows the deploy workflow instead. deploy.yml names the commit each run
# deploys in its title and only succeeds once /api/health reports that commit,
# so a green run for this commit (or a newer one containing it) prints the
# banner marked "health check by the deploy workflow".
#
# Every GitHub call goes through `gh api` (REST), never GraphQL (`gh pr view`,
# `gh run list`, `gh run watch`), so it also runs from Claude Code cloud
# sessions, where GraphQL answers 403.

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
    read -r STATE MERGE_SHA < <(gh api "repos/${REPO}/pulls/${PR}" \
      -q '"\(if .merged then "MERGED" elif .state == "closed" then "CLOSED" else "OPEN" end) \(.merge_commit_sha // "-")"')
    [ "$STATE" = MERGED ] && { SHA="$MERGE_SHA"; break; }
    [ "$STATE" = CLOSED ] && { log "PR #${PR} was closed without merging"; exit 1; }
    sleep 20
  done
  TITLE="$(gh api "repos/${REPO}/pulls/${PR}" -q .title)"
elif [ -n "$ARG" ]; then
  SHA="$(gh api "repos/${REPO}/commits/${ARG}" -q .sha)"
else
  SHA="$(gh api "repos/${REPO}/commits/main" -q .sha)"
fi
if [ -z "$PR" ]; then
  PR="$(gh api "repos/${REPO}/commits/${SHA}/pulls" -q '.[0].number // empty' 2>/dev/null || true)"
  [ -n "$PR" ] && TITLE="$(gh api "repos/${REPO}/pulls/${PR}" -q .title)"
fi
SHORT="${SHA::7}"
log "commit ${SHORT}${PR:+ (PR #${PR})}"

# Wait for a workflow run on this commit to exist, then follow it to the end.
follow() { # workflow-file event
  local id=""
  for _ in $(seq 1 60); do
    id="$(gh api "repos/${REPO}/actions/workflows/$1/runs?branch=main&event=$2&head_sha=${SHA}&per_page=20" \
      -q "[.workflow_runs[] | select(.head_sha == \"${SHA}\")][0].id // empty")"
    [ -n "$id" ] && break
    sleep 10
  done
  [ -n "$id" ] || { log "no $1 run for ${SHORT} after 10 minutes"; return 1; }
  log "following $1 run ${id}"
  # Same as `gh run watch --exit-status --interval 20`: poll until the run
  # completes, and fail on any conclusion but success (failure, cancelled by a
  # newer push, timed out).
  local st=""
  while :; do
    st="$(gh api "repos/${REPO}/actions/runs/${id}" -q '"\(.status) \(.conclusion // "-")"')"
    [ "${st%% *}" = completed ] && break
    sleep 20
  done
  [ "${st#* }" = success ] ||
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

# Sets LIVE to the version production reports, and REFUSED to the proxy's
# status when a proxy refused the CONNECT tunnel: curl exits 56 for that (22
# with --fail on newer builds) and %{http_connect} carries the proxy's answer,
# which stays 000 without a proxy and is 200 when the tunnel opened.
probe() {
  local out rc=0
  # The app scales to zero, so a request may wait on a cold start.
  out="$(curl -fsS --max-time 90 -w '\n%{http_connect}' "${ORIGIN%/}/api/health" 2>/dev/null)" || rc=$?
  CONNECT="${out##*$'\n'}"
  LIVE="$(printf '%s' "${out%$'\n'*}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  if { [ "$rc" = 56 ] || [ "$rc" = 22 ]; } && [[ "$CONNECT" =~ ^[45][0-9][0-9]$ ]]; then
    REFUSED="$CONNECT"
  fi
}

# deploy.yml titles each run "deploy <sha>" after the commit it deploys (the
# API's head_sha is main's newest commit, not that one). Sets LIVE to the
# deployed commit of a green run for SHA or a newer commit containing it,
# else FAILED to a failed run for SHA or one created since CI finished.
workflow_verdict() {
  local id conclusion deployed after
  local q='.workflow_runs[] | select(.status == "completed") | "\(.id) \(.conclusion) \((.display_title // "") | if test("^deploy [0-9a-f]{40}$") then ltrimstr("deploy ") else "-" end) \(.created_at >= "'"${CI_DONE}"'")"'
  LIVE=""
  FAILED=""
  while read -r id conclusion deployed after; do
    case "$conclusion" in
      success)
        if [ "$deployed" = "$SHA" ] ||
          { [ "$after" = true ] && [ "$deployed" != - ] && contains "$deployed" </dev/null; }; then
          LIVE="$deployed"
          DEPLOY_RUN="$id"
          return 0
        fi
        ;;
      failure | timed_out)
        if [ -z "$FAILED" ] && { [ "$deployed" = "$SHA" ] || [ "$after" = true ]; }; then
          FAILED="$id"
        fi
        ;;
    esac
  done < <(gh api "repos/${REPO}/actions/workflows/deploy.yml/runs?per_page=20" -q "$q" 2>/dev/null)
}

LIVE=""
REFUSED=""
DEPLOY_RUN=""
for _ in $(seq 1 90); do # 30 minutes
  if [ -z "$REFUSED" ]; then
    probe
    if [ -n "$REFUSED" ]; then
      log "a proxy refused the tunnel to ${ORIGIN} (CONNECT ${REFUSED}); following the deploy workflow, which checks /api/health itself"
    fi
  fi
  if [ -n "$REFUSED" ]; then
    workflow_verdict
    if [ -n "$LIVE" ]; then break; fi
    if [ -n "$FAILED" ]; then
      log "a deploy failed while waiting: https://github.com/${REPO}/actions/runs/${FAILED}"
      exit 1
    fi
    sleep 20
    continue
  fi
  if [ -n "$LIVE" ] && contains "$LIVE"; then break; fi
  FAILED="$(gh api "repos/${REPO}/actions/workflows/deploy.yml/runs?per_page=10" \
    -q "[.workflow_runs[] | select(.created_at >= \"${CI_DONE}\" and (.conclusion == \"failure\" or .conclusion == \"timed_out\"))][0].id // empty")"
  if [ -n "$FAILED" ]; then
    log "a deploy failed while waiting: https://github.com/${REPO}/actions/runs/${FAILED}"
    exit 1
  fi
  LIVE=""
  sleep 20
done
if [ -z "$LIVE" ]; then
  if [ -n "$REFUSED" ]; then
    log "no green deploy run for ${SHORT} within 30 minutes (this machine cannot reach ${ORIGIN} to check it)"
  else
    log "${ORIGIN} did not serve ${SHORT} within 30 minutes"
  fi
  exit 1
fi
VIA=""
[ "$LIVE" != "$SHA" ] && VIA=" (via ${LIVE::7})"

line() { printf '║  %-61s║\n' "$1"; }
if [ -n "$REFUSED" ]; then
  log "deploy run https://github.com/${REPO}/actions/runs/${DEPLOY_RUN} saw ${ORIGIN%/}/api/health report ${LIVE::7}"
  HEADLINE="✅  LIVE IN PRODUCTION (health check by the deploy workflow)"
  WHERE="${ORIGIN} (this machine cannot reach it)"
else
  HEADLINE="✅  LIVE IN PRODUCTION"
  WHERE="${ORIGIN}"
fi
echo "╔═══════════════════════════════════════════════════════════════╗"
line "$HEADLINE"
line "${SHORT}${PR:+ · PR #${PR}}${VIA}"
[ -n "$TITLE" ] && line "${TITLE:0:61}"
line "$WHERE"
echo "╚═══════════════════════════════════════════════════════════════╝"
