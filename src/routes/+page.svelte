<script lang="ts">
  import type { PageProps } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Mark from '$lib/components/Mark.svelte';
  import EpisodeRow from '$lib/components/EpisodeRow.svelte';
  import EpisodeDetailModal from '$lib/components/EpisodeDetailModal.svelte';
  import OrnateFrame from '$lib/components/OrnateFrame.svelte';
  import FloralDivider from '$lib/components/FloralDivider.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDayShortFr, formatDateShortFr, relativeFr } from '$lib/utils/date';
  import * as api from '$lib/api';
  import { t } from '$lib/i18n';

  let { data }: PageProps = $props();

  const today = $derived(new Date(data.now));
  const todayLabel = $derived(formatDateShortFr(today));

  /* Upcoming-window toggle. The server load fetches a 90-day window;
   * the UI defaults to the next 7 days and lets the user expand to
   * the full window with a single click. Slicing client-side avoids
   * an extra round-trip on toggle. */
  const DEFAULT_DAYS = 7;
  const EXPANDED_DAYS = 90;
  let upcomingExpanded = $state(false);
  const upcomingCutoffIso = $derived.by(() => {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + (upcomingExpanded ? EXPANDED_DAYS : DEFAULT_DAYS));
    return cutoff.toISOString().slice(0, 10);
  });
  const visibleUpcoming = $derived(
    data.upcoming.filter((ep) => (ep.airDate ?? '') <= upcomingCutoffIso)
  );
  const hiddenUpcomingCount = $derived(data.upcoming.length - visibleUpcoming.length);

  /* `data.recent` is still loaded server-side (and on the local target)
   * so we can distinguish "fresh user with no series followed" from
   * "user who has watched everything they follow" in the empty-state
   * branch below. The full list itself is no longer rendered on the
   * home page — it lives on /history and stays one tap away via the
   * `home.viewHistory` link in the toWatch section header. */
  const hasHistory = $derived(data.recent.length > 0);

  let removeModal = $state<null | { seriesTmdbId: number; seriesName: string }>(null);

  /* Modal shape accepts either a toWatch row or an upcoming row — both
   * carry the fields the popup needs. The structural type matches any
   * episode-like with seriesName, so that we can open the modal from
   * either home section. */
  type EpisodeModalData = {
    seriesName: string;
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
    overview: string | null;
    airDate: string | null;
    runtimeMinutes: number | null;
    stillPath: string | null;
  };
  let episodeModal = $state<EpisodeModalData | null>(null);
  function openEpisodeDetail(ep: EpisodeModalData) {
    episodeModal = ep;
  }
  function closeEpisodeDetail() {
    episodeModal = null;
  }

  async function markEpisode(episodeId: number) {
    await api.markEpisodeWatched(episodeId);
    await invalidateAll();
  }

  function requestUnfollow(seriesTmdbId: number, seriesName: string) {
    removeModal = { seriesTmdbId, seriesName };
  }

  async function confirmUnfollow() {
    if (!removeModal) return;
    const id = removeModal.seriesTmdbId;
    removeModal = null;
    await api.unfollowSeries(id);
    await invalidateAll();
  }

  function cancelUnfollow() {
    removeModal = null;
  }
</script>

<svelte:head><title>{$t('home.title')}</title></svelte:head>

<main class="app">
  <header class="topbar topbar--sticky">
    <div class="topbar__brand">
      <Mark />
      <h1 class="topbar__title">Episode</h1>
    </div>
    <div class="topbar__date">{todayLabel}</div>
  </header>

  <section class="home-section home-section--now">
    <div class="section">
      <div class="section__title">
        {$t('home.toWatchTitle')}
        <span class="section__count section__count--badge">{data.toWatch.length}</span>
        {#if hasHistory}
          <a class="section__link" href="/history">{$t('home.viewHistory')}</a>
        {/if}
      </div>
    </div>

    {#if data.toWatch.length === 0}
      {#if data.upcoming.length === 0 && !hasHistory}
        <!-- Fresh user — no series yet. Steer them to the search. -->
        <OrnateFrame>
          <div class="empty empty--cta">
            <div class="empty__title">{$t('home.noSeriesYet')}</div>
            <p class="empty__body">{$t('home.noSeriesBody')}</p>
            <a class="btn btn--accent btn--lg empty__cta" href="/search"
              >{$t('home.discoverSeries')}</a
            >
            <p class="empty__hint">
              {$t('home.importTip')}
              <a href="/settings">{$t('common.settings')}</a>.
            </p>
          </div>
        </OrnateFrame>
      {:else}
        <div class="empty">
          <div class="empty__title">{$t('home.allCaughtUp')}</div>
          {$t('home.comeBackTomorrow')}
        </div>
      {/if}
    {:else}
      <div class="swipe-hint">{$t('home.swipeHint')}</div>
      {#each data.toWatch as ep (ep.id)}
        <EpisodeRow
          episodeId={ep.id}
          seriesTmdbId={ep.seriesTmdbId}
          seriesName={ep.seriesName}
          seriesPoster={ep.seriesPoster}
          episodeName={ep.name}
          seasonNumber={ep.seasonNumber}
          episodeNumber={ep.episodeNumber}
          runtimeMinutes={ep.runtimeMinutes}
          onSwipeRight={() => markEpisode(ep.id)}
          onSwipeLeft={() => requestUnfollow(ep.seriesTmdbId, ep.seriesName)}
          onTitleClick={() => openEpisodeDetail(ep)}
        />
      {/each}
    {/if}
  </section>

  {#if data.upcoming.length > 0}
    <FloralDivider />
    <section class="home-section home-section--upcoming">
      <div class="timeline-marker timeline-marker--down" aria-hidden="true">
        <span>{$t('home.upcomingMarker')}</span>
      </div>
      <div class="section">
        <div class="section__title">
          {$t('home.upcomingTitle')}
          <span class="section__count"
            >{upcomingExpanded
              ? $t('home.upcomingWindowExpanded')
              : $t('home.upcomingWindow')}</span
          >
        </div>
      </div>
      <div class="upcoming">
        {#each visibleUpcoming as ep (ep.id)}
          {@const d = formatDayShortFr(ep.airDate ?? '')}
          <div class="upcoming__row">
            <div class="upcoming__day" aria-hidden="true">{d.weekday}<strong>{d.day}</strong></div>
            <button
              type="button"
              class="upcoming__body"
              onclick={() => openEpisodeDetail(ep)}
              aria-label={$t('series.episodeViewSynopsisAria', {
                code: formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)
              })}
            >
              <div class="episode__series">{ep.seriesName}</div>
              <h3 class="episode__title">{ep.name ?? `Épisode ${ep.episodeNumber}`}</h3>
              <div class="episode__meta">
                {formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)}
              </div>
            </button>
            <span class="ep-date">{relativeFr(ep.airDate ?? '', today)}</span>
          </div>
        {/each}
      </div>
      {#if !upcomingExpanded && hiddenUpcomingCount > 0}
        <button class="upcoming__expand" type="button" onclick={() => (upcomingExpanded = true)}>
          {$t('home.upcomingSeeMore', { n: hiddenUpcomingCount })}
        </button>
      {:else if upcomingExpanded}
        <button class="upcoming__expand" type="button" onclick={() => (upcomingExpanded = false)}>
          {$t('home.upcomingSeeLess')}
        </button>
      {/if}
    </section>
  {/if}

  <div class="spacer"></div>
  <BottomNav current="home" />
</main>

{#if episodeModal}
  <EpisodeDetailModal
    seriesName={episodeModal.seriesName}
    seasonNumber={episodeModal.seasonNumber}
    episodeNumber={episodeModal.episodeNumber}
    name={episodeModal.name}
    overview={episodeModal.overview}
    airDate={episodeModal.airDate}
    runtimeMinutes={episodeModal.runtimeMinutes}
    stillPath={episodeModal.stillPath}
    onClose={closeEpisodeDetail}
  />
{/if}

{#if removeModal}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="remove-title"
    transition:fade={{ duration: 140 }}
  >
    <div class="modal" transition:scale={{ duration: 260, start: 0.92, easing: backOut }}>
      <div class="modal__kicker">{$t('common.confirm')}</div>
      <h2 class="modal__title" id="remove-title">
        {$t('home.unfollowConfirmTitle', { name: removeModal.seriesName })}
      </h2>
      <p class="modal__body">{$t('home.unfollowConfirmBody')}</p>
      <div class="modal__actions">
        <button class="btn btn--secondary" type="button" onclick={cancelUnfollow}
          >{$t('common.cancel')}</button
        >
        <button class="btn btn--accent" type="button" onclick={confirmUnfollow}
          >{$t('home.unfollowConfirmAction')}</button
        >
      </div>
    </div>
  </div>
{/if}
