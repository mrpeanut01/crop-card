<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '$app/forms';
  import type { SignInChannel } from '$lib/identity';
  import AlphaBanner from '$lib/components/feedback/AlphaBanner.svelte';
  import type { ActionData, PageData } from './$types';
  import { createT, type MessageKey } from '$lib/i18n';
  import { page } from '$app/state';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const tr = $derived(createT(page.data?.locale));
  const isEnglish = $derived((page.data?.locale ?? 'en') === 'en');

  let showDemo = $state(false);
  let submitting = $state(false);
  let startingDemo = $state(false);
  let demoError = $state<string | null>(null);

  const startDemo: SubmitFunction = () => {
    startingDemo = true;
    demoError = null;
    return async ({ result }) => {
      if (result.type === 'redirect') {
        window.location.href = result.location;
        return;
      }
      startingDemo = false;
      demoError =
        result.type === 'failure' && typeof result.data?.demoError === 'string'
          ? result.data.demoError
          : tr('entry.demo.errOff');
    };
  };
  const via = $derived<SignInChannel>(form && 'via' in form && form.via ? form.via : data.via);
  const enteredBefore = $derived(form && 'entered' in form ? (form.entered ?? '') : '');
  const sent = $derived(form && 'sent' in form && form.sent ? form : null);
  const inviteToken = $derived(form?.inviteToken ?? data.inviteToken);

  function hrefFor(target: SignInChannel): string {
    const params = new URLSearchParams();
    if (target === 'phone') params.set('via', 'phone');
    if (inviteToken) params.set('invite', inviteToken);
    const q = params.toString();
    return q ? `/?${q}` : '/';
  }

  function pending() {
    submitting = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      submitting = false;
    };
  }

  const GROUPS = [
    { id: 'garden', items: [1, 2, 3, 4] },
    { id: 'fields', items: [1, 2, 3, 4, 5] },
    { id: 'animals', items: [1, 2, 3, 4] },
    { id: 'records', items: [1, 2, 3, 4] }
  ] as const;
  const DAILY = [1, 2, 3, 4] as const;

  const demoRoles = $derived([
    { role: 'owner', label: tr('entry.land.demoOwner'), sub: tr('entry.land.demoOwnerSub') },
    { role: 'helper', label: tr('entry.land.demoHelper'), sub: tr('entry.land.demoHelperSub') },
    {
      role: 'inspector',
      label: tr('entry.land.demoInspector'),
      sub: tr('entry.land.demoInspectorSub')
    },
    {
      role: 'custom-operator',
      label: tr('entry.land.demoCustom'),
      sub: tr('entry.land.demoCustomSub')
    }
  ]);
</script>

<svelte:head>
  <title>{tr('entry.land.title')}</title>
  <meta name="description" content={tr('entry.land.description')} />
</svelte:head>

<main class="landing" aria-labelledby="hero-title">
  <section class="hero">
    <div class="hero-inner">
      <a href="/" class="brand" aria-label={tr('entry.land.homeAria')}>
        <svg class="brand-mark" viewBox="0 0 32 32" width="40" height="40" aria-hidden="true">
          <!-- Stylized seedling — two leaves on a stem. -->
          <path
            d="M16 28 V18"
            stroke="#1f5e3a"
            stroke-width="2.5"
            stroke-linecap="round"
            fill="none"
          />
          <path d="M16 18 C 10 18, 6 14, 6 8 C 12 8, 16 12, 16 18 Z" fill="#4a8b54" />
          <path d="M16 18 C 22 18, 26 14, 26 8 C 20 8, 16 12, 16 18 Z" fill="#6db367" />
        </svg>
        <span class="brand-text">CropCard</span>
      </a>

      <h1 id="hero-title">
        {tr('entry.land.h1a')}<br />
        <span class="hero-accent">{tr('entry.land.h1b')}</span>
      </h1>
      <p class="lede">
        {tr('entry.land.lede')}
      </p>

      <p class="who">{tr('entry.land.who')}</p>

      <p class="hero-links">
        <a href="/start" data-testid="start-link">{tr('entry.land.startLink')}</a>
      </p>
      <p class="pricing-link">
        {tr('entry.land.freePre')} <a href="/pricing">{tr('entry.land.freeLink')}</a>
      </p>

      <!-- Decorative agricultural scene. Pure SVG so it ships offline; no
           external image asset. Three planted rows, a sun, and a barn silhouette. -->
      <svg class="hero-art" viewBox="0 0 600 220" role="img" aria-label={tr('entry.land.artAria')}>
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#dbecf5" />
            <stop offset="100%" stop-color="#f5f7f4" />
          </linearGradient>
          <linearGradient id="soil" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#a3744f" />
            <stop offset="100%" stop-color="#6f4d2f" />
          </linearGradient>
        </defs>
        <!-- Sky -->
        <rect x="0" y="0" width="600" height="140" fill="url(#sky)" />
        <!-- Sun -->
        <circle cx="490" cy="50" r="26" fill="#f5c34a" opacity="0.9" />
        <circle cx="490" cy="50" r="38" fill="#f5c34a" opacity="0.18" />
        <!-- Rolling hills -->
        <path
          d="M0 130 C 120 100, 240 110, 360 105 S 540 95, 600 110 L 600 140 L 0 140 Z"
          fill="#86b275"
          opacity="0.55"
        />
        <path
          d="M0 140 C 100 120, 200 130, 320 125 S 540 120, 600 130 L 600 140 L 0 140 Z"
          fill="#5b8d57"
          opacity="0.7"
        />
        <!-- Barn -->
        <g transform="translate(70 70)">
          <rect x="0" y="20" width="60" height="50" fill="#b65a3c" />
          <polygon points="0,20 30,0 60,20" fill="#9a4a31" />
          <rect x="22" y="40" width="16" height="30" fill="#3a2418" />
          <rect x="6" y="28" width="10" height="10" fill="#f5deb3" />
          <rect x="44" y="28" width="10" height="10" fill="#f5deb3" />
        </g>
        <!-- Soil rows -->
        <rect x="0" y="140" width="600" height="80" fill="url(#soil)" />
        <!-- Planted rows -->
        <g fill="#3f7a3a" opacity="0.85">
          <ellipse cx="50" cy="160" rx="4" ry="6" />
          <ellipse cx="100" cy="162" rx="4" ry="6" />
          <ellipse cx="150" cy="160" rx="4" ry="6" />
          <ellipse cx="200" cy="163" rx="4" ry="6" />
          <ellipse cx="250" cy="161" rx="4" ry="6" />
          <ellipse cx="300" cy="160" rx="4" ry="6" />
          <ellipse cx="350" cy="162" rx="4" ry="6" />
          <ellipse cx="400" cy="160" rx="4" ry="6" />
          <ellipse cx="450" cy="161" rx="4" ry="6" />
          <ellipse cx="500" cy="163" rx="4" ry="6" />
          <ellipse cx="550" cy="160" rx="4" ry="6" />
        </g>
        <g fill="#4a8b54" opacity="0.9">
          <ellipse cx="30" cy="180" rx="5" ry="7" />
          <ellipse cx="85" cy="182" rx="5" ry="7" />
          <ellipse cx="140" cy="180" rx="5" ry="7" />
          <ellipse cx="195" cy="183" rx="5" ry="7" />
          <ellipse cx="250" cy="181" rx="5" ry="7" />
          <ellipse cx="305" cy="180" rx="5" ry="7" />
          <ellipse cx="360" cy="182" rx="5" ry="7" />
          <ellipse cx="415" cy="180" rx="5" ry="7" />
          <ellipse cx="470" cy="181" rx="5" ry="7" />
          <ellipse cx="525" cy="183" rx="5" ry="7" />
          <ellipse cx="580" cy="180" rx="5" ry="7" />
        </g>
        <g fill="#5fa05f">
          <ellipse cx="15" cy="205" rx="6" ry="8" />
          <ellipse cx="75" cy="207" rx="6" ry="8" />
          <ellipse cx="135" cy="205" rx="6" ry="8" />
          <ellipse cx="195" cy="208" rx="6" ry="8" />
          <ellipse cx="255" cy="206" rx="6" ry="8" />
          <ellipse cx="315" cy="205" rx="6" ry="8" />
          <ellipse cx="375" cy="207" rx="6" ry="8" />
          <ellipse cx="435" cy="205" rx="6" ry="8" />
          <ellipse cx="495" cy="206" rx="6" ry="8" />
          <ellipse cx="555" cy="208" rx="6" ry="8" />
        </g>
      </svg>
    </div>
  </section>

  <section class="auth" aria-labelledby="signin-title">
    <div class="auth-card">
      <AlphaBanner />
      <h2 id="signin-title">{tr('entry.land.signIn')}</h2>
      {#if !sent && via === 'phone'}
        <p class="auth-hint">
          {tr('entry.land.hintPhone')}
        </p>
      {:else if !sent}
        <p class="auth-hint">
          {tr('entry.land.hintEmail')}
        </p>
      {/if}

      {#if form?.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}

      {#if data.inviteToken}
        <p class="invite-banner" role="status">{tr('entry.land.invited')}</p>
      {/if}

      {#if data.authMode === 'magic-link' && sent}
        <div class="sent" role="status" aria-live="polite">
          {#if sent.channel === 'sms'}
            <p><strong>{tr('entry.land.checkTexts')}</strong></p>
            <p>{tr('entry.land.sentSms', { to: sent.sentTo })}</p>
          {:else}
            <p><strong>{tr('entry.land.checkEmail')}</strong></p>
            <p>
              {tr('entry.land.sentEmail', { to: sent.sentTo })}
            </p>
          {/if}
        </div>

        {#if 'codeError' in sent && sent.codeError}
          <p class="error" role="alert">{sent.codeError}</p>
        {/if}

        <form method="POST" action="?/code" use:enhance={pending}>
          <label class="row">
            <span class="lbl">{tr('entry.land.codeLabel')}</span>
            <input
              class="code-input"
              type="text"
              name="code"
              required
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="7"
              placeholder="123456"
            />
          </label>
          <input type="hidden" name="identifier" value={sent.identifier} />
          {#if inviteToken}
            <input type="hidden" name="invite" value={inviteToken} />
          {/if}
          <button class="primary" type="submit" disabled={submitting}>
            {submitting ? tr('entry.land.checking') : tr('entry.land.signInBtn')}
          </button>
        </form>

        <div class="code-actions">
          <form method="POST" action="?/magic" use:enhance={pending}>
            <input type="hidden" name="identifier" value={sent.identifier} />
            <input
              type="hidden"
              name="channel"
              value={sent.channel === 'sms' ? 'phone' : 'email'}
            />
            {#if inviteToken}
              <input type="hidden" name="invite" value={inviteToken} />
            {/if}
            <button class="link-btn" type="submit" disabled={submitting}>
              {sent.channel === 'sms' ? tr('entry.land.newCode') : tr('entry.land.newEmail')}
            </button>
          </form>
          {#if sent.channel === 'sms'}
            <a class="link-btn" href={hrefFor('phone')} data-sveltekit-reload>
              {tr('entry.land.otherNumber')}
            </a>
            <a class="link-btn" href={hrefFor('email')} data-sveltekit-reload
              >{tr('entry.land.useEmail')}</a
            >
          {:else}
            <a class="link-btn" href={hrefFor('email')} data-sveltekit-reload>
              {tr('entry.land.otherEmail')}
            </a>
          {/if}
        </div>
      {:else}
        <form
          method="POST"
          action={data.authMode === 'magic-link' ? '?/magic' : '?/signin'}
          use:enhance={pending}
        >
          <input type="hidden" name="channel" value={via} />
          {#if via === 'phone'}
            <label class="row">
              <span class="lbl">{tr('entry.land.mobile')}</span>
              <input
                type="tel"
                name="identifier"
                required
                defaultValue={enteredBefore}
                autocomplete="tel"
                inputmode="tel"
                placeholder="(571) 555-0123"
              />
            </label>
            <p class="consent" lang="en" data-english-only="regulatory">
              CropCard will text you a sign-in code. Msg &amp; data rates may apply. Reply STOP to
              opt out, HELP for help.
            </p>
            {#if !isEnglish}
              <p class="consent" data-testid="sms-consent-translation">
                {tr('entry.land.smsConsentTranslation')}
              </p>
            {/if}
          {:else}
            <label class="row">
              <span class="lbl">{tr('entry.land.email')}</span>
              <input
                type="email"
                name="identifier"
                required
                defaultValue={enteredBefore}
                autocomplete="email"
                inputmode="email"
                placeholder={tr('signin.placeholderEmail')}
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
              />
            </label>
            {#if data.authMode === 'magic-link'}
              <p class="field-note">
                {tr('entry.land.noPassword')}
              </p>
            {/if}
          {/if}
          {#if data.inviteToken}
            <input type="hidden" name="invite" value={data.inviteToken} />
          {/if}
          <button class="primary" type="submit" disabled={submitting}>
            {#if submitting}
              {data.authMode === 'magic-link'
                ? tr('entry.land.sending')
                : tr('entry.land.signingIn')}
            {:else if data.authMode !== 'magic-link'}
              {tr('entry.land.continue')}
            {:else if via === 'phone'}
              {tr('entry.land.textMe')}
            {:else}
              {tr('entry.land.emailMe')}
            {/if}
          </button>
        </form>

        <div class="alt-path">
          {#if via === 'phone'}
            <a class="link-btn" href={hrefFor('email')}>{tr('entry.land.useEmail')}</a>
          {:else}
            <a class="link-btn" href={hrefFor('phone')}>{tr('entry.land.usePhone')}</a>
          {/if}
        </div>

        {#if data.authMode !== 'magic-link'}
          <details class="demo" bind:open={showDemo}>
            <summary>{tr('entry.land.demo')}</summary>
            <p class="demo-hint">
              {tr('entry.land.demoHint')}
            </p>
            <div class="demo-grid">
              {#each demoRoles as r (r.role)}
                <form method="POST" action="?/demo" use:enhance>
                  <input type="hidden" name="role" value={r.role} />
                  {#if data.inviteToken}
                    <input type="hidden" name="invite" value={data.inviteToken} />
                  {/if}
                  <button class="demo-btn" type="submit">
                    <strong>{r.label}</strong>
                    <small>{r.sub}</small>
                  </button>
                </form>
              {/each}
            </div>
          </details>
        {/if}
      {/if}
    </div>

    {#if data.demoEnabled && !data.inviteToken}
      <div class="tour-card" id="demo-farm" data-testid="demo-card">
        {#if data.demoExpired}
          <p class="tour-note" role="status">{tr('entry.demo.expired')}</p>
        {/if}
        <p class="tour-kicker">{tr('entry.demo.kicker')}</p>
        <h2 class="tour-title">{tr('entry.demo.title')}</h2>
        <p class="tour-body">{tr('entry.demo.body')}</p>
        {#if demoError}
          <p class="error" role="alert">{demoError}</p>
        {/if}
        <form method="POST" action="/demo?/start" use:enhance={startDemo}>
          <button class="tour-btn" type="submit" disabled={startingDemo} data-testid="demo-start">
            {startingDemo ? tr('entry.demo.starting') : tr('entry.demo.cta')}
          </button>
        </form>
      </div>
    {/if}
  </section>

  <section class="features" aria-labelledby="do-title">
    <div class="features-inner">
      <h2 id="do-title">{tr('entry.land.do.title')}</h2>
      <p class="features-lede">{tr('entry.land.do.lede')}</p>

      <div class="groups">
        {#each GROUPS as g (g.id)}
          <section class="group" aria-labelledby="do-{g.id}" data-testid="do-{g.id}">
            <h3 id="do-{g.id}">{tr(`entry.land.do.${g.id}.title`)}</h3>
            <ul>
              {#each g.items as n (n)}
                <li>{tr(`entry.land.do.${g.id}.${n}` as MessageKey)}</li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>

      <section class="daily" aria-labelledby="do-daily">
        <h3 id="do-daily">{tr('entry.land.do.daily.title')}</h3>
        <ul>
          {#each DAILY as n (n)}
            <li>{tr(`entry.land.do.daily.${n}`)}</li>
          {/each}
        </ul>
      </section>

      <section class="newbie" aria-labelledby="new-title" data-testid="new-to-growing">
        <div>
          <h2 id="new-title">{tr('entry.land.new.title')}</h2>
          <p>{tr('entry.land.new.body')}</p>
        </div>
        <a class="newbie-btn" href="/start">{tr('entry.land.new.cta')}</a>
      </section>

      <footer class="auth-footer">
        <small>
          {tr('entry.land.footer')}
        </small>
      </footer>
    </div>
  </section>
</main>

<style>
  .tour-card {
    box-sizing: border-box;
    width: 100%;
    max-width: 26rem;
    margin: 1.5rem auto 0;
    padding: 20px 22px;
    border-radius: 14px;
    background: #eaf3e4;
    border: 1px solid #c4dcb6;
    color: #1d3a24;
  }
  .tour-kicker {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #2f6b3e;
  }
  .tour-title {
    margin: 4px 0 6px;
    font-size: 20px;
  }
  .tour-body {
    margin: 0 0 14px;
    line-height: 1.45;
  }
  .tour-note {
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #fff7e0;
    color: #6b4e12;
  }
  .tour-btn {
    width: 100%;
    min-height: 48px;
    border: none;
    border-radius: 10px;
    background: #1f5e3a;
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .tour-btn:disabled {
    opacity: 0.7;
    cursor: progress;
  }
  /* Layout: hero and sign-in side by side on desktop, stacked on phones
     (short hero, then the form), with the feature sections full width below. */
  .landing {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1fr;
    background: #f5f7f4;
    color: #1a1a1a;
  }
  @media (min-width: 960px) {
    .landing {
      grid-template-columns: 1.05fr 0.95fr;
    }
  }

  /* ── Hero (left column) ────────────────────────────────────────── */
  .hero {
    background:
      radial-gradient(1200px 600px at 0% 0%, #e7f1e6 0%, transparent 60%),
      linear-gradient(180deg, #f5f7f4 0%, #eef3eb 100%);
    padding: 1.25rem 1.5rem 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @media (min-width: 960px) {
    .hero {
      padding: 4rem 3rem;
    }
  }
  .hero-inner {
    max-width: 32rem;
    width: 100%;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: #1f5e3a;
    margin-bottom: 0.75rem;
    min-height: auto; /* override the global 48px */
  }
  .brand-text {
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  h1 {
    margin: 0 0 0.75rem;
    font-size: clamp(1.75rem, 4.2vw, 2.75rem);
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: #14422a;
  }
  .hero-accent {
    color: #1f5e3a;
    background: linear-gradient(120deg, #1f5e3a 0%, #4a8b54 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .lede {
    margin: 0 0 0.75rem;
    color: #3d4742;
    font-size: 1.05rem;
    line-height: 1.55;
    max-width: 32rem;
  }
  .who {
    margin: 0;
    color: #3d4742;
    line-height: 1.55;
    display: none;
  }
  .hero-links {
    margin: 0.5rem 0 0;
  }
  .hero-links a,
  .pricing-link a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: #1f5e3a;
    font-weight: 600;
  }
  .pricing-link {
    margin: 0;
    font-size: 0.95rem;
    color: #3d4742;
  }
  .hero-art {
    width: 100%;
    max-width: 36rem;
    margin-top: 1.5rem;
    border-radius: 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    display: none;
  }
  @media (min-width: 960px) {
    .brand {
      margin-bottom: 1.5rem;
    }
    .who,
    .hero-art {
      display: block;
    }
    .hero-links {
      margin-top: 1rem;
    }
  }

  /* ── Auth (right column) ───────────────────────────────────────── */
  .auth {
    background: white;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-top: 1px solid #e6ebe5;
    border-bottom: 1px solid #e6ebe5;
  }
  @media (min-width: 960px) {
    .auth {
      padding: 4rem 3rem;
      border-top: none;
      border-bottom: none;
      border-left: 1px solid #e6ebe5;
    }
  }
  .auth-card {
    max-width: 26rem;
    width: 100%;
    margin: 0 auto;
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    color: #14422a;
  }
  .auth-hint {
    color: #3d4742;
    margin: 0 0 1.25rem;
    line-height: 1.45;
  }
  .invite-banner {
    background: #e7f4ee;
    border: 1px solid #b9d8c5;
    color: #14422a;
    padding: 0.625rem 0.875rem;
    border-radius: 0.375rem;
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .code-input {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 22px;
    letter-spacing: 0.3em;
  }
  .code-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
  }
  .code-actions form {
    margin: 0;
  }
  .link-btn {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    background: none;
    border: 0;
    padding: 0 4px;
    color: #1f5e3a;
    font: inherit;
    font-size: 14px;
    text-decoration: underline;
    cursor: pointer;
  }
  .field-note,
  .consent {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: #3d4742;
  }
  .consent {
    background: #f4f8f3;
    border: 1px solid #d6ddd6;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
  }
  .alt-path {
    margin-top: 0.75rem;
    display: flex;
    justify-content: center;
  }
  .sent {
    background: #e7f4ee;
    border: 1px solid #b9d8c5;
    color: #14422a;
    padding: 0.875rem 1rem;
    border-radius: 0.5rem;
  }
  .sent p {
    margin: 0 0 0.5rem;
  }
  .error {
    background: #fdecec;
    border: 1px solid #e3a8a8;
    color: #6b1717;
    padding: 0.625rem 0.875rem;
    border-radius: 0.375rem;
    margin: 0 0 1rem;
  }
  form {
    display: grid;
    gap: 0.875rem;
  }
  .row {
    display: grid;
    gap: 0.375rem;
  }
  .lbl {
    font-weight: 600;
    font-size: 0.875rem;
    color: #3d4742;
  }
  input[type='text'],
  input[type='email'],
  input[type='tel'] {
    font: inherit;
    padding: 0.75rem 0.875rem;
    border: 1px solid #c9d2c9;
    border-radius: 0.5rem;
    min-height: 48px;
    background: #fbfbf9;
  }
  input[type='text']:focus,
  input[type='email']:focus,
  input[type='tel']:focus {
    outline: 2px solid #1f5e3a;
    outline-offset: 1px;
    background: white;
  }
  .primary {
    min-height: 48px;
    padding: 0.75rem 1.25rem;
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: filter 120ms ease;
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* ── Demo expander ─────────────────────────────────────────────── */
  .demo {
    margin-top: 1.75rem;
    border-top: 1px dashed #d6ddd6;
    padding-top: 1.25rem;
  }
  .demo summary {
    list-style: none;
    cursor: pointer;
    color: #1f5e3a;
    font-weight: 600;
    padding: 0.375rem 0;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .demo summary::-webkit-details-marker {
    display: none;
  }
  .demo summary::before {
    content: '▸';
    transition: transform 150ms ease;
    display: inline-block;
  }
  .demo[open] summary::before {
    transform: rotate(90deg);
  }
  .demo-hint {
    color: #555;
    font-size: 0.875rem;
    margin: 0.5rem 0 0.75rem;
  }
  .demo-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }
  .demo-grid form {
    display: contents;
  }
  .demo-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.125rem;
    background: #f4f8f3;
    border: 1px solid #c9d2c9;
    color: #14422a;
    padding: 0.625rem 0.875rem;
    border-radius: 0.375rem;
    cursor: pointer;
    text-align: left;
    font: inherit;
    min-height: 56px;
  }
  .demo-btn:hover {
    border-color: #1f5e3a;
    background: #eaf3e9;
  }
  .demo-btn strong {
    font-size: 0.95rem;
  }
  .demo-btn small {
    color: #555;
    font-size: 0.8rem;
  }

  /* ── What you can do (full width) ──────────────────────────────── */
  .features {
    grid-column: 1 / -1;
    padding: 2.5rem 1.5rem 3rem;
    background: #f5f7f4;
  }
  .features-inner {
    max-width: 68rem;
    margin: 0 auto;
  }
  .features h2 {
    font-size: 1.6rem;
  }
  .features-lede {
    margin: 0 0 1.5rem;
    color: #3d4742;
  }
  .groups {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 640px) {
    .groups {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (min-width: 1100px) {
    .groups {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  .group {
    min-width: 0;
    background: white;
    border: 1px solid #dfe6dd;
    border-radius: 0.875rem;
    padding: 1.25rem;
  }
  .features h3 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
    color: #14422a;
  }
  .group ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.6rem;
  }
  .group li {
    position: relative;
    padding-left: 1.25rem;
    color: #3d4742;
    line-height: 1.5;
  }
  .group li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #4a8b54;
  }
  .daily {
    margin-top: 1.5rem;
  }
  .daily ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .daily li {
    padding: 0.5rem 0.875rem;
    border-radius: 999px;
    background: #e7f1e6;
    border: 1px solid #c4dcb6;
    color: #1d3a24;
    font-size: 0.95rem;
  }
  .newbie {
    margin-top: 2rem;
    padding: 1.5rem;
    border-radius: 0.875rem;
    background: #fff7e0;
    border: 1px solid #ead9a4;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .newbie > div {
    flex: 1 1 18rem;
    min-width: 0;
  }
  .newbie h2 {
    font-size: 1.35rem;
    margin: 0 0 0.25rem;
  }
  .newbie p {
    margin: 0;
    color: #4a4330;
    line-height: 1.5;
  }
  .newbie-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 1.25rem;
    border-radius: 0.5rem;
    background: #1f5e3a;
    color: white;
    font-weight: 600;
    text-decoration: none;
  }
  .auth-footer {
    margin-top: 2rem;
    text-align: center;
  }
  .auth-footer small {
    color: #6c756e;
    line-height: 1.5;
  }
</style>
