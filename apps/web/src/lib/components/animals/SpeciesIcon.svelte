<script lang="ts">
  import { Beef, Cat, Dog, Egg, Feather, Ham, Milk, PawPrint, Rabbit } from 'lucide-svelte';

  interface Props {
    icon: string | null | undefined;
    size?: number;
  }

  const { icon, size = 20 }: Props = $props();

  const ICONS: Record<string, typeof PawPrint> = {
    beef: Beef,
    cat: Cat,
    dog: Dog,
    egg: Egg,
    feather: Feather,
    ham: Ham,
    milk: Milk,
    'paw-print': PawPrint,
    rabbit: Rabbit
  };
  const Icon = $derived((icon && ICONS[icon]) || PawPrint);
</script>

<Icon {size} strokeWidth={1.75} aria-hidden="true" />
