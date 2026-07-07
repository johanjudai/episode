<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import { pushBackInterceptor } from '$lib/native/back';

  /**
   * Fullscreen-ish overlay that embeds a YouTube video via the
   * iframe API. The CSP `frame-src` only allows youtube-nocookie.com,
   * which serves the privacy-enhanced player (no cookies until the
   * user actually presses play). Autoplay is enabled because the
   * modal is user-initiated.
   */
  interface Props {
    youtubeKey: string;
    seriesName: string;
    trailerName: string | null;
    onClose: () => void;
  }
  let { youtubeKey, seriesName, trailerName, onClose }: Props = $props();

  const embedUrl = $derived(
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&rel=0&modestbranding=1`
  );

  /* Android back button / swipe closes the trailer instead of navigating. */
  onMount(() =>
    pushBackInterceptor(() => {
      onClose();
      return true;
    })
  );
</script>

<div
  class="modal-backdrop trailer-modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="trailer-modal-title"
  tabindex="-1"
  transition:fade={{ duration: 140 }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
>
  <div class="trailer-modal" transition:scale={{ duration: 260, start: 0.92, easing: backOut }}>
    <div class="trailer-modal__head">
      <div>
        <div class="modal__kicker">{seriesName}</div>
        <h2 class="modal__title" id="trailer-modal-title">
          {trailerName ?? $t('series.trailerDefault')}
        </h2>
      </div>
      <button
        type="button"
        class="iconbtn trailer-modal__close"
        onclick={onClose}
        aria-label={$t('common.close')}>✕</button
      >
    </div>
    <div class="trailer-modal__frame">
      <iframe
        src={embedUrl}
        title={trailerName ?? `Trailer ${seriesName}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </div>
  </div>
</div>

<style>
  .trailer-modal {
    width: min(92vw, 920px);
    background: var(--surface);
    color: var(--fg);
    border: var(--border-w) solid var(--border);
    display: grid;
    grid-template-rows: auto 1fr;
    gap: var(--s-3);
    padding: var(--s-3);
  }
  .trailer-modal__head {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: var(--s-3);
  }
  .trailer-modal__close {
    align-self: start;
  }
  .trailer-modal__frame {
    /* 16:9 responsive embed — width is constrained by parent, height
     * follows via the aspect-ratio property which is widely supported
     * on every browser we ship for. */
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--bw-black);
  }
  .trailer-modal__frame iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }

  /* Art Nouveau rounds the modal to match the rest of the palette */
  :global([data-palette='artnouveau']) .trailer-modal {
    border-radius: 20px;
  }
</style>
