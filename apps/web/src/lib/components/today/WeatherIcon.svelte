<script lang="ts">
  import {
    Sun,
    Moon,
    CloudSun,
    CloudMoon,
    Cloud,
    CloudRain,
    CloudLightning,
    CloudSnow,
    CloudFog
  } from 'lucide-svelte';
  import type { WeatherSky } from '$lib/today/weatherSummary';

  interface Props {
    sky: WeatherSky;
    size?: number;
  }
  const { sky, size = 16 }: Props = $props();

  const SKY_ICON: Record<WeatherSky, typeof Sun> = {
    clear: Sun,
    'clear-night': Moon,
    partly: CloudSun,
    'partly-night': CloudMoon,
    cloudy: Cloud,
    rain: CloudRain,
    storm: CloudLightning,
    snow: CloudSnow,
    fog: CloudFog
  };
  const Icon = $derived(SKY_ICON[sky] ?? Cloud);
</script>

<Icon {size} strokeWidth={1.75} aria-hidden="true" />
