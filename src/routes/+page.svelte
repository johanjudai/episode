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
  import { onMount } from 'svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDayShortFr, formatDateShortFr, relativeFr } from '$lib/utils/date';
  import { localIsoDate } from '$lib/utils/airtime';
  import * as api from '$lib/api';
  import { t } from '$lib/i18n';
  import { IS_LOCAL, APP_VERSION } from '$lib/config';
  import { checkForUpdate, dueForCheck, type UpdateInfo } from '$lib/update';

  let { data }: PageProps = $props();

  /* ---- In-app update banner (Android APK only) ------------------------
   * On native, check GitHub Releases for a newer signed APK and offer a
   * one-tap download+install via the native ApkInstaller plugin. Throttled
   * to once a day via localStorage; entirely no-op on the web/Docker build
   * (and on the local build running in a plain browser). */
  const UPDATE_CHECK_KEY = 'episode.update.lastCheck';
  let updateInfo = $state<UpdateInfo | null>(null);
  let updatePhase = $state<'idle' | 'downloading' | 'installing' | 'error'>('idle');
  let updateProgress = $state(-1); // 0..100, or -1 when unknown
  let updateErrorKey = $state<'error' | 'unknownSources'>('error');

  onMount(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      if (!IS_LOCAL) return;
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;

      const lastRaw = localStorage.getItem(UPDATE_CHECK_KEY);
      const last = lastRaw ? Number(lastRaw) : null;
      if (!dueForCheck(last, Date.now())) return;
      localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now()));

      const { ApkInstaller } = await import('$lib/native/apkInstaller');
      let current = APP_VERSION;
      try {
        const info = await ApkInstaller.getAppInfo();
        if (info.versionName) current = info.versionName;
      } catch {
        /* fall back to the bundled version */
      }

      const found = await checkForUpdate(current);
      if (!found) return;
      updateInfo = found;

      const handle = await ApkInstaller.addListener('downloadProgress', (e) => {
        updateProgress = e.progress < 0 ? -1 : Math.round(e.progress * 100);
      });
      cleanup = () => handle.remove();
    })();
    return () => cleanup?.();
  });

  async function installUpdate() {
    if (!updateInfo) return;
    updatePhase = 'downloading';
    updateProgress = -1;
    try {
      const { ApkInstaller } = await import('$lib/native/apkInstaller');
      await ApkInstaller.installApk({
        url: updateInfo.apkUrl,
        fileName: `episode-${updateInfo.tag}.apk`
      });
      updatePhase = 'installing';
    } catch (err) {
      updateErrorKey =
        (err as { code?: string })?.code === 'UNKNOWN_SOURCES' ? 'unknownSources' : 'error';
      updatePhase = 'error';
    }
  }

  function dismissUpdate() {
    updateInfo = null;
  }

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
  /* An episode's effective day is the local calendar day of its release
   * instant (release_at, resolved in the device timezone) when we have it —
   * so a release that unlocks just after local midnight buckets under the
   * right day. Falls back to the bare air_date for legacy rows. */
  function effectiveDate(ep: { releaseAt?: number | null; airDate: string | null }): string {
    return ep.releaseAt != null ? localIsoDate(ep.releaseAt) : (ep.airDate ?? '');
  }
  const visibleUpcoming = $derived(
    data.upcoming.filter((ep) => effectiveDate(ep) <= upcomingCutoffIso)
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

  {#if updateInfo}
    <div class="update-banner" role="status" transition:fade={{ duration: 160 }}>
      <div class="update-banner__text">
        <div class="update-banner__title">{$t('update.title')}</div>
        <p class="update-banner__body">
          {#if updatePhase === 'downloading'}
            {updateProgress < 0
              ? $t('update.preparing')
              : $t('update.downloading', { percent: updateProgress })}
          {:else if updatePhase === 'installing'}
            {$t('update.installing')}
          {:else if updatePhase === 'error'}
            {$t(`update.${updateErrorKey}`)}
          {:else}
            {$t('update.body', { version: updateInfo.version })}
          {/if}
        </p>
      </div>
      <div class="update-banner__actions">
        {#if updatePhase === 'downloading' || updatePhase === 'installing'}
          <span class="update-banner__spinner" aria-hidden="true"></span>
        {:else}
          <button type="button" class="btn btn--accent btn--sm" onclick={installUpdate}>
            {updatePhase === 'error' ? $t('update.retry') : $t('update.action')}
          </button>
          <button type="button" class="update-banner__dismiss" onclick={dismissUpdate}>
            {$t('update.dismiss')}
          </button>
        {/if}
      </div>
    </div>
  {/if}

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
          {@const epDate = effectiveDate(ep)}
          {@const d = formatDayShortFr(epDate)}
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
            <span class="ep-date">{relativeFr(epDate, today)}</span>
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
