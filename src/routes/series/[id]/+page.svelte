<script lang="ts">
  import type { PageProps } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { slide, scale, fade } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDateShortFr } from '$lib/utils/date';
  import { posterUrl } from '$lib/utils/images';
  import { countUnwatchedBefore, findInProgressSeason } from '$lib/utils/episodes';
  import * as api from '$lib/api';

  let { data }: PageProps = $props();

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
    try {
      await api.markEpisodeForSeries({
        seriesTmdbId: seriesId,
        seasonNumber: args.seasonNumber,
        episodeNumber: args.episodeNumber,
        watched: args.watched,
        markPrevious: args.markPrevious
      });
      await invalidateAll();
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
    try {
      await api.markSeasonForSeries({
        seriesTmdbId: seriesId,
        seasonNumber: args.seasonNumber,
        watched: args.watched,
        markPrevious: args.markPrevious
      });
      await invalidateAll();
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
      title: 'Marquer aussi les épisodes précédents ?',
      body: `${count} épisode${count > 1 ? 's' : ''} avant ${formatEpisodeCode(seasonNumber, episodeNumber)} ${
        count > 1 ? 'sont' : 'est'
      } non vu${count > 1 ? 's' : ''}.`
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
      title: 'Marquer aussi les saisons précédentes ?',
      body: `${count} épisode${count > 1 ? 's' : ''} dans les saisons antérieures ${
        count > 1 ? 'sont' : 'est'
      } non vu${count > 1 ? 's' : ''}.`
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
    try {
      await api.markAllForSeries(seriesId);
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{data.series?.name ?? 'Série'} — Episode</title></svelte:head>

{#if !data.series}
  <main class="app">
    <div class="empty">
      <div class="empty__title">Chargement…</div>
    </div>
  </main>
{:else}
  <main class="app">
    <header class="topbar">
      <a class="iconbtn" href="/search" aria-label="Retour">←</a>
      <div class="topbar__date">Fiche série</div>
      <div style="width: 40px"></div>
    </header>

    <section class="hero">
      <div class="hero__poster" aria-hidden="true" style={heroStyle}></div>
      <div>
        <h1 class="hero__title">{data.series.name}</h1>
        <div class="hero__meta">
          {data.series.firstAirDate?.slice(0, 4) ?? '—'}
          {#if data.series.network}· {data.series.network}{/if}
          {#if data.series.numberOfSeasons}· {data.series.numberOfSeasons} saisons{/if}
        </div>
      </div>
    </section>

    <section class="progress">
      <div class="progress__label">
        <span>Progression</span>
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
        {data.progress.watched}<small>/ {data.progress.total} épisodes</small>
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
          Tout cocher
        </button>
        <button
          class="btn btn--secondary btn--block"
          type="button"
          onclick={unfollowCurrent}
          disabled={busy}
        >
          Retirer du suivi
        </button>
      {:else}
        <button
          class="btn btn--accent btn--block"
          type="button"
          style="grid-column: 1 / -1"
          onclick={followCurrent}
          disabled={busy}
        >
          Suivre cette série
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
              ? `Décocher saison ${s.seasonNumber}`
              : `Tout cocher saison ${s.seasonNumber}`}
            aria-pressed={isComplete}
            disabled={busy}
            onclick={() => onSeasonToggle(s.seasonNumber, isComplete)}
            >{isComplete ? '✓' : '○'}</button
          >
          <button
            class="iconbtn"
            type="button"
            aria-label={isExpanded
              ? `Replier la saison ${s.seasonNumber}`
              : `Déplier la saison ${s.seasonNumber}`}
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
                  aria-label={`Marquer ${formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)} ${ep.watched ? 'non vu' : 'vu'}`}
                  aria-pressed={ep.watched}
                  disabled={busy}
                  style={ep.watched ? 'background: var(--bw-black); color: var(--bw-white)' : ''}
                  onclick={() => onEpisodeToggle(ep.seasonNumber, ep.episodeNumber, ep.watched)}
                  >{ep.watched ? '✓' : ''}</button
                >
                <span class="ep-code">{formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)}</span>
                <span>{ep.name ?? `Épisode ${ep.episodeNumber}`}</span>
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
      <div class="modal__kicker">Confirmation</div>
      <h2 class="modal__title" id="confirm-title">{pending.title}</h2>
      <p class="modal__body">{pending.body}</p>
      <div class="modal__actions">
        <button class="btn btn--secondary" type="button" onclick={() => confirmPending(false)}
          >Seulement celui-ci</button
        >
        <button class="btn btn--accent" type="button" onclick={() => confirmPending(true)}
          >Tout marquer</button
        >
      </div>
      <button
        class="btn btn--secondary btn--block"
        type="button"
        onclick={cancelPending}
        style="margin-top: var(--s-2)"
      >
        Annuler
      </button>
    </div>
  </div>
{/if}
