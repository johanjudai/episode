<script lang="ts">
  /**
   * Full-page overlay shown while the TV Time import is running.
   *
   * Driven by an `ImportProgress` event stream from `$lib/api`. The
   * overlay fills the viewport, blocks interaction, and animates a
   * global progress bar + sequential fun messages. When `summary`
   * lands, it switches to a "done" state with a CTA back to the app.
   */
  import { fade, fly, scale } from 'svelte/transition';
  import { t } from '$lib/i18n';
  import {
    computeEtaSeconds,
    computeOverallPercent,
    estimateTotalMinutes,
    formatEta,
    selectMessage,
    type MessageId
  } from '$lib/utils/import-progress';
  import type { TvTimeImportProgress, TvTimeImportSummary } from '$lib/api';

  interface Props {
    progress: TvTimeImportProgress | null;
    summary: TvTimeImportSummary | null;
    onDone: () => void;
  }

  let { progress, summary, onDone }: Props = $props();

  /* Monotonic start time so ETA doesn't jitter when progress events
   * land out of order. Captured on first paint via $effect, not at
   * module init (the overlay may be mounted ahead of time). */
  let startedAt = $state<number | null>(null);
  let now = $state(Date.now());
  $effect(() => {
    if (progress && startedAt === null) startedAt = Date.now();
  });
  $effect(() => {
    /* Ticker so the ETA refreshes once per second even when no
     * progress event arrives (e.g. during a long single TMDB call). */
    if (!progress || summary) return;
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  const percent = $derived(computeOverallPercent(progress));
  /* Up-front rough estimate while we haven't seen a single progress
   * event yet. We don't know the real series/watch counts at this
   * point (the ZIP is decrypted server-side or in the worker
   * thread), so we use the typical-library numbers — ~200 series,
   * ~5 k watches — which yields the "this may take ~10 min" hint
   * the reviewer asked for. Once the parse phase emits, the
   * dynamic ETA below takes over and this line is hidden. */
  const upfrontMinutes = $derived(estimateTotalMinutes(200, 5000));
  const etaSeconds = $derived(
    startedAt !== null ? computeEtaSeconds(startedAt, now, percent) : null
  );

  const messageId = $derived<MessageId>(selectMessage(progress));
  /* Resolve the i18n key per message id. Translations live in
   * settings.importMsg* so they share the import-flow namespace. */
  function messageText(id: MessageId, p: TvTimeImportProgress | null): string {
    const total = p?.total ?? 0;
    const current = p?.current ?? 0;
    switch (id) {
      case 'warmup':
        return $t('settings.importMsgWarmup');
      case 'series-wow':
        return $t('settings.importMsgSeriesWow', { total });
      case 'resolving':
        return $t('settings.importMsgResolving');
      case 'resolving-mid':
        return $t('settings.importMsgResolvingMid', { current, total });
      case 'syncing':
        return $t('settings.importMsgSyncing');
      case 'syncing-tail':
        return $t('settings.importMsgSyncingTail');
      case 'marking-start':
        return $t('settings.importMsgMarkingStart', { total });
      case 'marking-mid':
        return $t('settings.importMsgMarkingMid', { current, total });
      case 'marking-tail':
        return $t('settings.importMsgMarkingTail');
      case 'finalizing':
        return $t('settings.importMsgFinalizing');
    }
  }
</script>

<div class="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-overlay-title">
  <div class="import-overlay__deco" aria-hidden="true">
    <span class="shape shape--circle"></span>
    <span class="shape shape--square"></span>
    <span class="shape shape--tri"></span>
  </div>

  {#if summary}
    <div class="import-overlay__panel" in:scale={{ duration: 360, start: 0.92 }}>
      <h1 id="import-overlay-title" class="import-overlay__title import-overlay__title--done">
        {$t('settings.importDoneTitle')}
      </h1>
      <p class="import-overlay__sub">
        {$t('settings.importDoneBody', {
          synced: summary.seriesSynced,
          watches: summary.watchesApplied
        })}
      </p>
      <button type="button" class="btn btn--accent btn--lg import-overlay__cta" onclick={onDone}>
        {$t('settings.importDoneCta')}
      </button>
    </div>
  {:else}
    <div class="import-overlay__panel">
      <h1 id="import-overlay-title" class="import-overlay__title">
        {$t('settings.importOverlayTitle')}
      </h1>
      <p class="import-overlay__sub">{$t('settings.importOverlaySub')}</p>

      {#if startedAt === null}
        <p class="import-overlay__upfront" in:fade>
          {$t('settings.importOverlayUpfront', { n: upfrontMinutes })}
        </p>
      {/if}

      <div
        class="import-overlay__bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class="import-overlay__bar-fill" style="width: {percent}%"></div>
        <span class="import-overlay__bar-text">{percent}%</span>
      </div>

      {#if etaSeconds !== null}
        <p class="import-overlay__eta" in:fade>
          {$t('settings.importOverlayEta', { eta: formatEta(etaSeconds) })}
        </p>
      {/if}

      <div class="import-overlay__feed" aria-live="polite">
        {#key messageId}
          <p
            class="import-overlay__msg"
            in:fly={{ y: 16, duration: 320 }}
            out:fade={{ duration: 180 }}
          >
            {messageText(messageId, progress)}
          </p>
        {/key}
      </div>

      {#if progress?.detail}
        <p class="import-overlay__detail" aria-hidden="true">{progress.detail}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .import-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: var(--s-4);
    /* The variables are palette-driven (set on :root by the
     * Bauhaus / Eco-brutalism / Art Nouveau themes). Hard fallbacks
     * keep the overlay opaque even if a palette forgot to set one. */
    background: var(--bg, #f5f1e8);
    color: var(--fg, #1a1a1a);
    overflow: hidden;
  }

  /* The deco shapes (.import-overlay__deco .shape--*) and their
   * keyframes live in app.css. They need to be global so the
   * `[data-palette='artnouveau']` overrides there can swap the
   * Bauhaus primitives for floral SVG masks — Svelte's scoped
   * styles would outscope the global palette selectors otherwise. */

  .import-overlay__panel {
    position: relative;
    z-index: 1;
    width: min(540px, 100%);
    text-align: center;
  }
  .import-overlay__title {
    font-size: clamp(1.6rem, 4vw, 2.2rem);
    margin: 0 0 var(--s-2);
    letter-spacing: -0.01em;
  }
  .import-overlay__title--done::after {
    content: ' ✓';
    color: var(--bw-yellow);
  }
  .import-overlay__sub {
    margin: 0 0 var(--s-5);
    opacity: 0.74;
  }
  .import-overlay__upfront {
    margin: 0 0 var(--s-3);
    opacity: 0.78;
    font-size: 0.95rem;
  }

  .import-overlay__bar {
    position: relative;
    height: 22px;
    border-radius: 999px;
    background: var(--surface-2, rgba(0, 0, 0, 0.08));
    overflow: hidden;
    margin-bottom: var(--s-2);
  }
  .import-overlay__bar-fill {
    height: 100%;
    background:
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.18) 0 10px, transparent 10px 20px),
      linear-gradient(90deg, var(--bw-yellow), color-mix(in srgb, var(--bw-yellow) 70%, white));
    border-radius: inherit;
    transition: width 480ms cubic-bezier(0.2, 0.8, 0.2, 1);
    /* The stripe layer moves on its own so the bar feels alive even
     * when the counter pauses on a slow TMDB request. */
    animation: stripes 1.2s linear infinite;
  }
  @keyframes stripes {
    from {
      background-position:
        0 0,
        0 0;
    }
    to {
      background-position:
        0 0,
        40px 0;
    }
  }
  :global([data-motion='reduced']) .import-overlay__bar-fill {
    animation: none;
  }
  .import-overlay__bar-text {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    mix-blend-mode: difference;
    color: white;
  }

  .import-overlay__eta {
    margin: var(--s-2) 0 var(--s-5);
    opacity: 0.72;
    font-variant-numeric: tabular-nums;
  }

  .import-overlay__feed {
    min-height: 4.5em;
    display: grid;
    place-items: center;
  }
  .import-overlay__msg {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.5;
    max-width: 32ch;
  }

  .import-overlay__detail {
    margin: var(--s-3) 0 0;
    font-size: 0.85rem;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
  }

  .import-overlay__cta {
    margin-top: var(--s-5);
  }
</style>
