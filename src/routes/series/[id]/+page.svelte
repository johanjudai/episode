<script lang="ts">
  import type { PageProps } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { slide, scale, fade } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Celebration from '$lib/components/Celebration.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDateShortFr } from '$lib/utils/date';
  import { posterUrl, stillUrl } from '$lib/utils/images';
  import { countUnwatchedBefore, findInProgressSeason } from '$lib/utils/episodes';
  import * as api from '$lib/api';
  import { t } from '$lib/i18n';

  let { data }: PageProps = $props();

  /* Track season + series completeness so we can fire a confetti
   * celebration the instant a mutation flips the boundary from
   * "incomplete" to "complete". Snapshot is taken before each
   * mutation; we recompute and compare after invalidateAll resolves. */
  type CompletionSnapshot = {
    seriesComplete: boolean;
    seasonsComplete: Map<number, boolean>;
  };
  function snapshotCompletion(): CompletionSnapshot {
    const seasonsComplete = new Map<number, boolean>();
    let hasAnyEpisode = false;
    let allWatched = true;
    for (const s of data.seasons) {
      if (s.episodes.length === 0) {
        seasonsComplete.set(s.seasonNumber, false);
        continue;
      }
      hasAnyEpisode = true;
      const done = s.episodes.every((e) => e.watched);
      seasonsComplete.set(s.seasonNumber, done);
      if (!done) allWatched = false;
    }
    return { seriesComplete: hasAnyEpisode && allWatched, seasonsComplete };
  }

  let celebration = $state<'season' | 'series' | null>(null);

  function detectCelebrations(before: CompletionSnapshot, after: CompletionSnapshot) {
    /* Series-complete trumps season-complete — only fire one. */
    if (!before.seriesComplete && after.seriesComplete) {
      celebration = 'series';
      return;
    }
    for (const [num, done] of after.seasonsComplete) {
      if (done && !before.seasonsComplete.get(num)) {
        celebration = 'season';
        return;
      }
    }
  }

  function dismissCelebration() {
    celebration = null;
  }

  /* Episode-detail popup. Opens with the synopsis, still frame, and
   * runtime when the user clicks an episode title or its SxxEyy code. */
  type EpisodeDetail = (typeof data.seasons)[number]['episodes'][number];
  let episodeModal = $state<EpisodeDetail | null>(null);
  function openEpisodeDetail(ep: EpisodeDetail) {
    episodeModal = ep;
  }
  function closeEpisodeDetail() {
    episodeModal = null;
  }

  const modalStillUrl = $derived(stillUrl(episodeModal?.stillPath ?? null, 'w500'));

  const seriesId = $derived(data.series?.tmdbId ?? null);
  const percent = $derived(
    data.progress.total > 0 ? Math.round((data.progress.watched / data.progress.total) * 100) : 0
  );
  const heroStyle = $derived(
    data.series?.posterPath
      ? `background-image: url('${posterUrl(data.series.posterPath, 'w342')}')`
      : ''
  );

  let expandedSeasons = $state<Set<number>>(
    (() => {
      const init = new Set<number>();
      const inProgress = findInProgressSeason(data.seasons);
      if (inProgress !== null) init.add(inProgress);
      return init;
    })()
  );

  function toggleSeason(n: number) {
    if (expandedSeasons.has(n)) expandedSeasons.delete(n);
    else expandedSeasons.add(n);
    expandedSeasons = new Set(expandedSeasons);
  }

  type PendingMark =
    | {
        kind: 'episode';
        seasonNumber: number;
        episodeNumber: number;
        watched: boolean;
        title: string;
        body: string;
      }
    | {
        kind: 'season';
        seasonNumber: number;
        watched: boolean;
        title: string;
        body: string;
      };

  let pending = $state<PendingMark | null>(null);
  let busy = $state(false);

  async function runEpisode(args: {
    seasonNumber: number;
    episodeNumber: number;
    watched: boolean;
    markPrevious?: boolean;
  }) {
    if (busy || seriesId === null) return;
    busy = true;
    const before = snapshotCompletion();
    try {
      await api.markEpisodeForSeries({
        seriesTmdbId: seriesId,
        seasonNumber: args.seasonNumber,
        episodeNumber: args.episodeNumber,
        watched: args.watched,
        markPrevious: args.markPrevious
      });
      await invalidateAll();
      if (args.watched) detectCelebrations(before, snapshotCompletion());
    } finally {
      busy = false;
    }
  }

  async function runSeason(args: {
    seasonNumber: number;
    watched: boolean;
    markPrevious?: boolean;
  }) {
    if (busy || seriesId === null) return;
    busy = true;
    const before = snapshotCompletion();
    try {
      await api.markSeasonForSeries({
        seriesTmdbId: seriesId,
        seasonNumber: args.seasonNumber,
        watched: args.watched,
        markPrevious: args.markPrevious
      });
      await invalidateAll();
      if (args.watched) detectCelebrations(before, snapshotCompletion());
    } finally {
      busy = false;
    }
  }

  async function onEpisodeToggle(seasonNumber: number, episodeNumber: number, wasWatched: boolean) {
    const willBeWatched = !wasWatched;
    if (!willBeWatched) {
      await runEpisode({ seasonNumber, episodeNumber, watched: false });
      return;
    }
    const count = countUnwatchedBefore(data.seasons, seasonNumber, episodeNumber);
    if (count === 0) {
      await runEpisode({ seasonNumber, episodeNumber, watched: true });
      return;
    }
    pending = {
      kind: 'episode',
      seasonNumber,
      episodeNumber,
      watched: true,
      title: $t('series.markPreviousEpisodesTitle'),
      body: $t('series.unwatchedBeforeEpisode', {
        count,
        code: formatEpisodeCode(seasonNumber, episodeNumber)
      })
    };
  }

  async function onSeasonToggle(seasonNumber: number, isComplete: boolean) {
    if (isComplete) {
      await runSeason({ seasonNumber, watched: false });
      return;
    }
    const count = countUnwatchedBefore(data.seasons, seasonNumber);
    if (count === 0) {
      await runSeason({ seasonNumber, watched: true });
      return;
    }
    pending = {
      kind: 'season',
      seasonNumber,
      watched: true,
      title: $t('series.markPreviousSeasonsTitle'),
      body: $t('series.unwatchedBeforeSeason', { count })
    };
  }

  async function confirmPending(markPrevious: boolean) {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.kind === 'episode') {
      await runEpisode({
        seasonNumber: p.seasonNumber,
        episodeNumber: p.episodeNumber,
        watched: true,
        markPrevious
      });
    } else {
      await runSeason({ seasonNumber: p.seasonNumber, watched: true, markPrevious });
    }
  }

  function cancelPending() {
    pending = null;
  }

  async function followCurrent() {
    if (busy || seriesId === null) return;
    busy = true;
    try {
      await api.followSeries(seriesId);
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function unfollowCurrent() {
    if (busy || seriesId === null) return;
    busy = true;
    try {
      await api.unfollowSeries(seriesId);
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function markAllCurrent() {
    if (busy || seriesId === null) return;
    busy = true;
    const before = snapshotCompletion();
    try {
      await api.markAllForSeries(seriesId);
      await invalidateAll();
      detectCelebrations(before, snapshotCompletion());
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{data.series?.name ?? $t('series.detailTitle')} — Episode</title></svelte:head>

{#if !data.series}
  <main class="app">
    <div class="empty">
      <div class="empty__title">{$t('common.loading')}</div>
    </div>
  </main>
{:else}
  <main class="app">
    <header class="topbar">
      <a class="iconbtn" href="/search" aria-label={$t('common.back')}>←</a>
      <div class="topbar__date">{$t('series.detailTitle')}</div>
      <div style="width: 36px"></div>
    </header>

    <section class="hero">
      <div class="hero__poster" aria-hidden="true" style={heroStyle}></div>
      <div>
        <h1 class="hero__title">{data.series.name}</h1>
        <div class="hero__meta">
          {data.series.firstAirDate?.slice(0, 4) ?? '—'}
          {#if data.series.network}· {data.series.network}{/if}
          {#if data.series.numberOfSeasons}· {$t('series.yearSeasons', {
              seasons: data.series.numberOfSeasons
            })}{/if}
        </div>
        {#if data.ratings && (data.ratings.tmdb || data.ratings.external.length > 0)}
          <div class="hero__ratings" aria-label="Notes externes">
            {#if data.ratings.tmdb}
              <span
                class="rating-chip rating-chip--tmdb"
                title={`${data.ratings.tmdb.count.toLocaleString('fr-FR')} votes TMDB`}
              >
                <strong>{data.ratings.tmdb.average.toFixed(1)}</strong>
                <span>TMDB</span>
              </span>
            {/if}
            {#each data.ratings.external as r (r.source)}
              <span class={`rating-chip rating-chip--${r.source}`}>
                <strong>{r.value}</strong>
                <span>
                  {#if r.source === 'rottentomatoes'}RT
                  {:else if r.source === 'imdb'}IMDb
                  {:else if r.source === 'metacritic'}Meta
                  {/if}
                </span>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section class="progress">
      <div class="progress__label">
        <span>{$t('series.progress')}</span>
        <span>{percent}%</span>
      </div>
      <div
        class="progress__bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="progress__fill" style="width: {percent}%"></div>
      </div>
      <div class="progress__numbers">
        {data.progress.watched}<small
          >/ {$t('series.progressNumbers', {
            watched: data.progress.watched,
            total: data.progress.total
          }).split('/')[1]}</small
        >
      </div>
    </section>

    <section class="actions">
      {#if data.followed}
        <button
          class="btn btn--accent btn--block"
          type="button"
          onclick={markAllCurrent}
          disabled={busy}
        >
          {$t('series.markAll')}
        </button>
        <button
          class="btn btn--secondary btn--block"
          type="button"
          onclick={unfollowCurrent}
          disabled={busy}
        >
          {$t('series.unfollow')}
        </button>
      {:else}
        <button
          class="btn btn--accent btn--block"
          type="button"
          style="grid-column: 1 / -1"
          onclick={followCurrent}
          disabled={busy}
        >
          {$t('series.follow')}
        </button>
      {/if}
    </section>

    {#if data.series.overview}
      <section class="synopsis">{data.series.overview}</section>
    {/if}

    {#each data.seasons as s (s.seasonNumber)}
      {@const seasonWatched = s.episodes.filter((e) => e.watched).length}
      {@const isExpanded = expandedSeasons.has(s.seasonNumber)}
      {@const isComplete = seasonWatched === s.episodes.length && s.episodes.length > 0}
      <section class="season">
        <div class="season__head">
          <div class="season__num">{String(s.seasonNumber).padStart(2, '0')}</div>
          <div>
            <div class="season__title">{s.name}</div>
            <div class="season__progress">{seasonWatched} / {s.episodes.length}</div>
          </div>
          <button
            class="season__checkall"
            type="button"
            aria-label={isComplete
              ? $t('series.seasonCheckAriaOff', { n: s.seasonNumber })
              : $t('series.seasonCheckAriaOn', { n: s.seasonNumber })}
            aria-pressed={isComplete}
            disabled={busy}
            onclick={() => onSeasonToggle(s.seasonNumber, isComplete)}
            >{isComplete ? '✓' : '○'}</button
          >
          <button
            class="iconbtn"
            type="button"
            aria-label={isExpanded
              ? $t('series.seasonCollapseAria', { n: s.seasonNumber })
              : $t('series.seasonExpandAria', { n: s.seasonNumber })}
            aria-expanded={isExpanded}
            onclick={() => toggleSeason(s.seasonNumber)}>{isExpanded ? '▴' : '▾'}</button
          >
        </div>
        {#if isExpanded}
          <ul class="season__list" transition:slide={{ duration: 220, easing: quintOut }}>
            {#each s.episodes as ep (ep.episodeNumber)}
              <li>
                <button
                  type="button"
                  class="checkbox"
                  aria-label={ep.watched
                    ? $t('series.episodeMarkAriaOff', {
                        code: formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)
                      })
                    : $t('series.episodeMarkAriaOn', {
                        code: formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)
                      })}
                  aria-pressed={ep.watched}
                  disabled={busy}
                  onclick={() => onEpisodeToggle(ep.seasonNumber, ep.episodeNumber, ep.watched)}
                  >{ep.watched ? '✓' : ''}</button
                >
                <button
                  type="button"
                  class="ep-title-trigger"
                  aria-label={$t('series.episodeViewSynopsisAria', {
                    code: formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)
                  })}
                  onclick={() => openEpisodeDetail(ep)}
                >
                  <span class="ep-code">
                    {formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)}
                  </span>
                  <span class="ep-title-trigger__name"
                    >{ep.name ?? `Épisode ${ep.episodeNumber}`}</span
                  >
                </button>
                <span class="ep-date">{ep.airDate ? formatDateShortFr(ep.airDate) : ''}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}

    <div class="spacer"></div>
    <BottomNav current="search" />
  </main>
{/if}

{#if pending}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-title"
    transition:fade={{ duration: 140 }}
  >
    <div class="modal" transition:scale={{ duration: 260, start: 0.92, easing: backOut }}>
      <div class="modal__kicker">{$t('common.confirm')}</div>
      <h2 class="modal__title" id="confirm-title">{pending.title}</h2>
      <p class="modal__body">{pending.body}</p>
      <div class="modal__actions">
        <button class="btn btn--secondary" type="button" onclick={() => confirmPending(false)}
          >{$t('series.onlyThisOne')}</button
        >
        <button class="btn btn--accent" type="button" onclick={() => confirmPending(true)}
          >{$t('series.markAllUpTo')}</button
        >
      </div>
      <button
        class="btn btn--secondary btn--block"
        type="button"
        onclick={cancelPending}
        style="margin-top: var(--s-2)"
      >
        {$t('common.cancel')}
      </button>
    </div>
  </div>
{/if}

{#if episodeModal}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ep-modal-title"
    tabindex="-1"
    transition:fade={{ duration: 140 }}
    onclick={(e) => {
      if (e.target === e.currentTarget) closeEpisodeDetail();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeEpisodeDetail();
    }}
  >
    <div
      class="modal modal--episode"
      transition:scale={{ duration: 260, start: 0.92, easing: backOut }}
    >
      {#if modalStillUrl}
        <div class="modal__still" style="background-image: url('{modalStillUrl}')"></div>
      {:else}
        <div class="modal__still modal__still--placeholder">
          {formatEpisodeCode(episodeModal.seasonNumber, episodeModal.episodeNumber)}
        </div>
      {/if}
      <div class="modal__inner">
        <div class="modal__kicker">{data.series?.name ?? $t('series.detailTitle')}</div>
        <h2 class="modal__title" id="ep-modal-title">
          {episodeModal.name ?? `Episode ${episodeModal.episodeNumber}`}
        </h2>
        <div class="modal__meta">
          <span class="ep-code"
            >{formatEpisodeCode(episodeModal.seasonNumber, episodeModal.episodeNumber)}</span
          >
          {#if episodeModal.airDate}
            <span>{formatDateShortFr(episodeModal.airDate)}</span>
          {/if}
          {#if episodeModal.runtime}
            <span>· {episodeModal.runtime} min</span>
          {/if}
          {#if episodeModal.watched}
            <span style="color: var(--bw-green); font-weight: 800">{$t('series.watchedBadge')}</span
            >
          {/if}
        </div>
        <p class="modal__body modal__body--prose">
          {episodeModal.overview ?? $t('series.noSynopsis')}
        </p>
        <div class="modal__actions">
          <button class="btn btn--secondary btn--block" type="button" onclick={closeEpisodeDetail}
            >{$t('common.close')}</button
          >
        </div>
      </div>
    </div>
  </div>
{/if}

{#if celebration}
  <Celebration kind={celebration} onDone={dismissCelebration} />
{/if}
