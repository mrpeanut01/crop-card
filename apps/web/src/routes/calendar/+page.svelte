<!--
  Stub component — the +page.server.ts load() throws redirect(302) before
  this template ever renders. Kept here because SvelteKit wants a +page
  for the route to register cleanly with `dev` HMR.
-->
<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  const tr = $derived(createT(page.data?.locale));
</script>

<p>{tr('today.calendar.redirecting')}</p>
