<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let showDemo = $state(false);
  let submitting = $state(false);

  const demoRoles = [
    { role: 'owner', label: 'Owner', sub: 'Full access' },
    { role: 'helper', label: 'Helper', sub: 'Field actions' },
    { role: 'inspector', label: 'Inspector', sub: 'Read-only' },
    { role: 'custom-operator', label: 'Custom op', sub: 'Block-scoped' }
  ] as const;
</script>

<svelte:head>
  <title>CropCard — Plan, spray, harvest in one card</title>
  <meta
    name="description"
    content="The offline-first farm record system: spray planning, calibration, planting calendar, harvest log."
  />
</svelte:head>

<main class="landing" aria-labelledby="hero-title">
  <section class="hero">
    <div class="hero-inner">
      <a href="/" class="brand" aria-label="CropCard home">
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
        The field card,<br />
        <span class="hero-accent">modernized.</span>
      </h1>
      <p class="lede">
        Plan sprays, record harvests, calibrate equipment — offline-first, glove-friendly, compliant
        with the 2-year retention rule. Built for small-plot growers who keep notes on the truck
        dash.
      </p>

      <ul class="bullets" aria-label="What CropCard does">
        <li>
          <span class="bullet-mark" aria-hidden="true">✓</span>
          Safety-kernel spray checks that won't let you spray a contaminated tank
        </li>
        <li>
          <span class="bullet-mark" aria-hidden="true">✓</span>
          1/128-acre calibration wizard with helper-submit + owner-approve flow
        </li>
        <li>
          <span class="bullet-mark" aria-hidden="true">✓</span>
          Offline-first PWA — record sprays in the field, sync when you're back at the truck
        </li>
        <li>
          <span class="bullet-mark" aria-hidden="true">✓</span>
          CSV + PDF exports ready for cost-share inspectors and USDA reporting
        </li>
      </ul>

      <!-- Decorative agricultural scene. Pure SVG so it ships offline; no
           external image asset. Three planted rows, a sun, and a barn silhouette. -->
      <svg
        class="hero-art"
        viewBox="0 0 600 220"
        role="img"
        aria-label="A stylized field with planted rows, a sun, and a barn"
      >
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
      <h2 id="signin-title">Sign in</h2>
      <p class="auth-hint">Enter your email. New here? We'll set up your farm in the next step.</p>

      {#if form?.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}

      {#if data.inviteToken}
        <p class="invite-banner" role="status">
          You've been invited to a farm — sign in to accept.
        </p>
      {/if}

      <form
        method="POST"
        action="?/signin"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
      >
        <label class="row">
          <span class="lbl">Email</span>
          <input
            type="email"
            name="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
            inputmode="email"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </label>
        {#if data.inviteToken}
          <input type="hidden" name="invite" value={data.inviteToken} />
        {/if}
        <button class="primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Continue →'}
        </button>
      </form>

      <details class="demo" bind:open={showDemo}>
        <summary>Try the demo</summary>
        <p class="demo-hint">
          One-tap sign-in to a sandbox tenant — pick a role to feel the surface area.
        </p>
        <div class="demo-grid">
          {#each demoRoles as r}
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
    </div>

    <footer class="auth-footer">
      <small>
        CropCard is offline-first — your records live on your device first, sync to the cloud
        second.
      </small>
    </footer>
  </section>
</main>

<style>
  /* Layout — split-screen on desktop, stacked on mobile (form first). */
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
    padding: 2rem 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    order: 2; /* mobile: hero below form */
  }
  @media (min-width: 960px) {
    .hero {
      order: 1;
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
    margin-bottom: 1.5rem;
    min-height: auto; /* override the global 48px */
  }
  .brand-text {
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  h1 {
    margin: 0 0 1rem;
    font-size: clamp(2rem, 4.2vw, 2.75rem);
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
    margin: 0 0 1.5rem;
    color: #3d4742;
    font-size: 1.05rem;
    line-height: 1.55;
    max-width: 32rem;
  }
  .bullets {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
    display: grid;
    gap: 0.6rem;
  }
  .bullets li {
    display: grid;
    grid-template-columns: 1.5rem 1fr;
    gap: 0.5rem;
    color: #3d4742;
    line-height: 1.5;
  }
  .bullet-mark {
    color: #1f5e3a;
    font-weight: 700;
  }
  .hero-art {
    width: 100%;
    max-width: 36rem;
    margin-top: 1.5rem;
    border-radius: 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    display: block;
  }

  /* ── Auth (right column) ───────────────────────────────────────── */
  .auth {
    background: white;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    order: 1; /* mobile: form first */
    border-bottom: 1px solid #e6ebe5;
  }
  @media (min-width: 960px) {
    .auth {
      order: 2;
      padding: 4rem 3rem;
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
  input[type='email'] {
    font: inherit;
    padding: 0.75rem 0.875rem;
    border: 1px solid #c9d2c9;
    border-radius: 0.5rem;
    min-height: 48px;
    background: #fbfbf9;
  }
  input[type='email']:focus {
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

  .auth-footer {
    margin-top: 2rem;
    text-align: center;
  }
  .auth-footer small {
    color: #6c756e;
    line-height: 1.5;
  }
</style>
