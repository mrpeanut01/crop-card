// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../../../../scripts/watch-deploy.sh', import.meta.url));

const hasJq = spawnSync('jq', ['--version']).status === 0;

const SHA = 'c0ffee'.padEnd(40, '1');
const NEWER = 'beef00'.padEnd(40, '2');
const OLDER = 'dead00'.padEnd(40, '3');
const ORIGIN = 'https://app.example.test';
const BEFORE_CI = '2000-01-01T00:00:00Z';
const AFTER_CI = '2099-01-01T00:00:00Z';

// `gh api <path> -q <filter>`: the first route whose text appears in the path
// answers with its fixture through jq, the way gh applies --jq. A route with
// numbered fixtures (name.1.json, name.2.json) answers them in turn, then
// name.json for every later call.
const GH = `#!/usr/bin/env bash
[ "$1" = api ] || { echo "stub gh: only gh api" >&2; exit 2; }
path="$2"; shift 2
filter=""
while [ $# -gt 0 ]; do
  case "$1" in -q | --jq) filter="$2"; shift ;; esac
  shift
done
printf '%s\\n' "$path" >> "$STUB_DIR/gh.calls"
while IFS=$'\\t' read -r pat name; do
  case "$path" in
    *"$pat"*)
      n=$(( $(cat "$STUB_DIR/n.$name" 2>/dev/null || echo 0) + 1 ))
      echo "$n" > "$STUB_DIR/n.$name"
      f="$STUB_DIR/fx/$name.$n.json"
      [ -f "$f" ] || f="$STUB_DIR/fx/$name.json"
      if [ -n "$filter" ]; then jq -r "$filter" < "$f"; else cat "$f"; fi
      exit $?
      ;;
  esac
done < "$STUB_DIR/routes.tsv"
echo "stub gh: no route for $path" >&2
exit 1
`;

// Prints CURL_BODY, then the -w template with %{http_connect} filled in, and
// exits CURL_RC, as curl does for a refused proxy tunnel, a timeout or a reply.
const CURL = `#!/usr/bin/env bash
w=""
while [ $# -gt 0 ]; do
  case "$1" in -w | --write-out) w="$2"; shift ;; esac
  shift
done
echo curl >> "$STUB_DIR/curl.calls"
printf '%s' "\${CURL_BODY:-}"
printf '%b' "$(printf '%s' "$w" | sed "s/%{http_connect}/\${CURL_CONNECT:-000}/g")"
exit "\${CURL_RC:-0}"
`;

const SLEEP = `#!/usr/bin/env bash
echo sleep >> "$STUB_DIR/sleep.calls"
`;

// The script's loops are \`seq 1 60\` and \`seq 1 90\`; cap them so a run that
// waits out a loop ends after SEQ_CAP passes instead of 90.
const SEQ = `#!/usr/bin/env bash
n="$2"
[ "$n" -gt "\${SEQ_CAP:-$n}" ] && n="$SEQ_CAP"
i="$1"
while [ "$i" -le "$n" ]; do echo "$i"; i=$((i + 1)); done
`;

type DeployRun = {
  id: number;
  title: string;
  conclusion: string | null;
  status?: string;
  created: string;
};

type Scenario = {
  curl: { rc: number; body?: string; connect?: string };
  deployRuns?: DeployRun[][];
  compare?: Record<string, string>;
};

const deployRun = (r: DeployRun) => ({
  id: r.id,
  display_title: r.title,
  status: r.status ?? 'completed',
  conclusion: r.conclusion,
  created_at: r.created,
  head_sha: NEWER
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const lines = (file: string) =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];

function watch(s: Scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), 'watch-deploy-'));
  dirs.push(dir);
  const bin = path.join(dir, 'bin');
  const fx = path.join(dir, 'fx');
  mkdirSync(bin);
  mkdirSync(fx);
  for (const [name, body] of Object.entries({ gh: GH, curl: CURL, sleep: SLEEP, seq: SEQ })) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const json = (name: string, v: unknown) =>
    writeFileSync(path.join(fx, `${name}.json`), JSON.stringify(v));

  const routes: [string, string][] = [['pulls/871', 'pr']];
  json('pr', { merged: true, state: 'closed', merge_commit_sha: SHA, title: 'Fix the watcher' });
  routes.push(['actions/workflows/ci.yml/runs', 'ci-runs']);
  json('ci-runs', { workflow_runs: [{ id: 101, head_sha: SHA }] });
  routes.push(['actions/runs/101', 'ci-run']);
  json('ci-run', { status: 'completed', conclusion: 'success' });
  routes.push(['deployments/9/statuses', 'statuses']);
  json('statuses', [{ environment_url: ORIGIN }]);
  routes.push(['deployments?environment=production', 'deployments']);
  json('deployments', [{ id: 9 }]);

  routes.push(['actions/workflows/deploy.yml/runs', 'deploy-runs']);
  const seqs = s.deployRuns ?? [[]];
  seqs.forEach((runs, i) => {
    const body = { workflow_runs: runs.map(deployRun) };
    json(i === seqs.length - 1 ? 'deploy-runs' : `deploy-runs.${i + 1}`, body);
  });

  for (const [other, status] of Object.entries(s.compare ?? {})) {
    routes.push([`compare/${SHA}...${other}`, `compare-${other}`]);
    json(`compare-${other}`, { status });
  }
  writeFileSync(path.join(dir, 'routes.tsv'), routes.map((r) => r.join('\t')).join('\n') + '\n');

  const res = spawnSync('bash', [script, '871'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      SEQ_CAP: '3',
      CROPCARD_REPO: 'acme/farm',
      CURL_RC: String(s.curl.rc),
      CURL_BODY: s.curl.body ?? '',
      CURL_CONNECT: s.curl.connect ?? '000'
    }
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    curlCalls: lines(path.join(dir, 'curl.calls')).length,
    ghCalls: lines(path.join(dir, 'gh.calls'))
  };
}

const health = (version: string) => JSON.stringify({ status: 'ok', version });
const REFUSED = { rc: 56, connect: '403' };
const FALLBACK_HEADLINE = '✅  LIVE IN PRODUCTION (health check by the deploy workflow)';

// CI runs on Linux with jq installed; a laptop without jq skips these.
describe.skipIf(!hasJq && !process.env.CI)('watch-deploy.sh', () => {
  it('prints the banner once production reports the commit', () => {
    const r = watch({ curl: { rc: 0, body: health(SHA) } });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/║ {2}✅ {2}LIVE IN PRODUCTION +║/);
    expect(r.stdout).toContain(`${SHA.slice(0, 7)} · PR #871`);
    expect(r.stdout).toMatch(new RegExp(`║ {2}${ORIGIN.replace(/\./g, '\\.')} +║`));
    expect(r.stdout).not.toContain('deploy workflow');
    expect(r.ghCalls.some((p) => p.includes('deploy.yml/runs'))).toBe(false);
  });

  it.each([
    ['exit 56', 56],
    ['exit 22 (newer curl with --fail)', 22]
  ])(
    'trusts a green deploy run for the commit when a proxy refuses the tunnel (%s)',
    (_label, rc) => {
      const r = watch({
        curl: { rc, connect: '403' },
        deployRuns: [
          [
            { id: 7, title: 'deploy', conclusion: 'success', created: AFTER_CI },
            { id: 6, title: `deploy ${SHA}`, conclusion: 'success', created: BEFORE_CI }
          ]
        ]
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(FALLBACK_HEADLINE);
      expect(r.stdout).toContain(`${ORIGIN} (this machine cannot reach it)`);
      expect(r.stdout).not.toContain('(via');
      expect(r.stderr).toContain('a proxy refused the tunnel');
      expect(r.stderr).toContain('actions/runs/6');
      expect(r.curlCalls).toBe(1);
    }
  );

  it('waits for the deploy run to finish, without asking the app again', () => {
    const r = watch({
      curl: REFUSED,
      deployRuns: [
        [
          {
            id: 6,
            title: `deploy ${SHA}`,
            conclusion: null,
            status: 'in_progress',
            created: BEFORE_CI
          }
        ],
        [{ id: 6, title: `deploy ${SHA}`, conclusion: 'success', created: BEFORE_CI }]
      ]
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(FALLBACK_HEADLINE);
    expect(r.curlCalls).toBe(1);
  });

  it('accepts a newer commit that contains this one, never one that does not', () => {
    const r = watch({
      curl: REFUSED,
      deployRuns: [
        [
          { id: 8, title: `deploy ${NEWER}`, conclusion: 'success', created: AFTER_CI },
          { id: 7, title: `deploy ${OLDER}`, conclusion: 'success', created: AFTER_CI }
        ]
      ],
      compare: { [NEWER]: 'ahead', [OLDER]: 'behind' }
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(FALLBACK_HEADLINE);
    expect(r.stdout).toContain(`(via ${NEWER.slice(0, 7)})`);

    const older = watch({
      curl: REFUSED,
      deployRuns: [[{ id: 7, title: `deploy ${OLDER}`, conclusion: 'success', created: AFTER_CI }]],
      compare: { [OLDER]: 'behind' }
    });
    expect(older.status).toBe(1);
    expect(older.stdout).not.toContain('LIVE IN PRODUCTION');
    expect(older.stderr).toContain('no green deploy run for');
    expect(older.curlCalls).toBe(1);
  });

  it.each([
    ['the run for this commit', `deploy ${SHA}`, BEFORE_CI, 'failure'],
    ['a run created since CI finished', 'deploy', AFTER_CI, 'timed_out']
  ])(
    'fails when a proxy refuses the tunnel and %s failed',
    (_label, title, created, conclusion) => {
      const r = watch({ curl: REFUSED, deployRuns: [[{ id: 6, title, conclusion, created }]] });
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('LIVE IN PRODUCTION');
      expect(r.stderr).toContain(
        'a deploy failed while waiting: https://github.com/acme/farm/actions/runs/6'
      );
      expect(r.curlCalls).toBe(1);
    }
  );

  it.each([
    ['a timeout', 28, '000'],
    ['a DNS failure', 6, '000'],
    ['a 5xx through an open tunnel', 22, '200'],
    ['a receive error without a proxy', 56, '000']
  ])('keeps asking the app after %s, as before', (_label, rc, connect) => {
    const r = watch({
      curl: { rc, connect },
      deployRuns: [[{ id: 6, title: `deploy ${SHA}`, conclusion: 'success', created: BEFORE_CI }]]
    });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('LIVE IN PRODUCTION');
    expect(r.stderr).toContain(`${ORIGIN} did not serve ${SHA.slice(0, 7)} within 30 minutes`);
    expect(r.stderr).not.toContain('proxy');
    expect(r.curlCalls).toBe(3);
  });

  it('keeps waiting while production serves an older version', () => {
    const r = watch({ curl: { rc: 0, body: health(OLDER) }, compare: { [OLDER]: 'behind' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('did not serve');
    expect(r.curlCalls).toBe(3);
  });

  it('still fails fast on a failed deploy when the app is reachable', () => {
    const r = watch({
      curl: { rc: 28 },
      deployRuns: [[{ id: 6, title: 'deploy', conclusion: 'failure', created: AFTER_CI }]]
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      'a deploy failed while waiting: https://github.com/acme/farm/actions/runs/6'
    );
    expect(r.curlCalls).toBe(1);
  });
});
