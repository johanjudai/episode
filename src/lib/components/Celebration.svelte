<script lang="ts">
  /**
   * Confetti burst overlay used when a season or a whole series is
   * completed. Renders 18 Bauhaus shapes (circle / square / triangle in
   * red / blue / yellow) bursting from the screen center, plus a brief
   * title chip that pops in then out.
   *
   * The overlay is fully decorative — pointer-events disabled, content
   * announced via aria-live so screen-readers get the news. It removes
   * itself by calling `onDone` after 1.8s.
   */
  import { onMount } from 'svelte';

  interface Props {
    kind: 'season' | 'series';
    onDone: () => void;
  }
  let { kind, onDone }: Props = $props();

  const shapes = ['circle', 'square', 'triangle'] as const;
  const colors = ['red', 'blue', 'yellow'] as const;

  /* 18 pieces — enough to feel like a burst, light enough on perf. */
  const pieces = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const distance = 160 + Math.random() * 140;
    return {
      shape: shapes[i % shapes.length],
      color: colors[Math.floor(Math.random() * colors.length)],
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      rot: (Math.random() - 0.5) * 720,
      size: 14 + Math.random() * 18,
      delay: Math.floor(Math.random() * 90)
    };
  });

  const message = $derived(kind === 'series' ? 'Série terminée !' : 'Saison terminée !');

  onMount(() => {
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  });
</script>

<div class="celebration" role="status" aria-live="polite">
  <div class={`celebration__title celebration__title--${kind}`}>{message}</div>
  {#each pieces as p, i (i)}
    <span
      class={`confetti confetti--${p.shape} confetti--${p.color}`}
      style="--dx: {p.dx}px; --dy: {p.dy}px; --rot: {p.rot}deg; --size: {p.size}px; animation-delay: {p.delay}ms"
    ></span>
  {/each}
</div>
