/**
 * Optional GitHub issue sync for feedback (#466). With GITHUB_FEEDBACK_TOKEN
 * and GITHUB_FEEDBACK_REPO set, a superadmin can review, edit and send a
 * note from /admin/feedback. Notes are never posted on arrival, because the
 * repo may be public. Without them it reports "not configured" and does
 * nothing.
 */

export const GITHUB_TIMEOUT_MS = 10_000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface GithubFeedbackConfig {
  token: string;
  repo: string;
}

export function githubFeedbackConfig(
  env: Record<string, string | undefined> = process.env
): GithubFeedbackConfig | null {
  const token = env.GITHUB_FEEDBACK_TOKEN?.trim();
  const repo = env.GITHUB_FEEDBACK_REPO?.trim();
  if (!token || !repo || !REPO_RE.test(repo)) return null;
  return { token, repo };
}

export type GithubIssueResult =
  | { ok: true; url: string; number: number }
  | { ok: false; reason: 'not-configured' | 'request-failed' | 'rejected'; status?: number };

export async function createGithubIssue(
  issue: { title: string; body: string },
  opts: {
    config?: GithubFeedbackConfig | null;
    fetcher?: typeof fetch;
    labels?: string[];
  } = {}
): Promise<GithubIssueResult> {
  const config = opts.config === undefined ? githubFeedbackConfig() : opts.config;
  if (!config) return { ok: false, reason: 'not-configured' };
  const fetcher = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await fetcher(`https://api.github.com/repos/${config.repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'CropCard-feedback',
        'x-github-api-version': '2022-11-28'
      },
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        ...(opts.labels && opts.labels.length > 0 ? { labels: opts.labels } : {})
      }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)
    });
  } catch {
    return { ok: false, reason: 'request-failed' };
  }
  if (!res.ok) return { ok: false, reason: 'rejected', status: res.status };
  try {
    const body = (await res.json()) as { html_url?: unknown; number?: unknown };
    const url = typeof body.html_url === 'string' ? body.html_url : null;
    if (!url || !url.startsWith('https://github.com/')) {
      return { ok: false, reason: 'rejected', status: res.status };
    }
    return { ok: true, url, number: typeof body.number === 'number' ? body.number : 0 };
  } catch {
    return { ok: false, reason: 'rejected', status: res.status };
  }
}
