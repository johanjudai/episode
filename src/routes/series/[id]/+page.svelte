<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDateShortFr } from '$lib/utils/date';
  import { posterUrl } from '$lib/utils/images';

  let { data }: PageProps = $props();

  const percent = $derived(
    data.progress.total > 0 ? Math.round((data.progress.watched / data.progress.total) * 100) : 0
  );

  const heroStyle = $derived(
    data.series.posterPath
      ? `background-image: url('${posterUrl(data.series.posterPath, 'w342')}')`
      : ''
  );
</script>

<svelte:head><title>{data.series.name} — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <a class="iconbtn" href="/search" aria-label="Retour">←</a>
    <div class="topbar__date">Fiche série</div>
    <form method="POST" action="?/unfollow" style="display:contents">
      <button class="iconbtn" type="submit" aria-label="Retirer du suivi">✕</button>
    </form>
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
    <div class="progress__bar" role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
      <div class="progress__fill" style="width: {percent}%"></div>
    </div>
    <div class="progress__numbers">
      {data.progress.watched}<small>/ {data.progress.total} épisodes</small>
    </div>
  </section>

  <section class="actions">
    {#if data.followed}
      <form method="POST" action="?/markAll">
        <button class="btn btn--accent btn--block" type="submit">Tout cocher</button>
      </form>
      <form method="POST" action="?/unfollow">
        <button class="btn btn--secondary btn--block" type="submit">Retirer du suivi</button>
      </form>
    {:else}
      <form method="POST" action="?/follow" style="grid-column: 1 / -1">
        <button class="btn btn--accent btn--block" type="submit">Suivre cette série</button>
      </form>
    {/if}
  </section>

  {#if data.series.overview}
    <section class="synopsis">{data.series.overview}</section>
  {/if}

  {#each data.seasons as s (s.seasonNumber)}
    {@const seasonWatched = s.episodes.filter((e) => e.watched).length}
    <section class="season">
      <div class="season__head">
        <div class="season__num">{String(s.seasonNumber).padStart(2, '0')}</div>
        <div>
          <div class="season__title">{s.name}</div>
          <div class="season__progress">{seasonWatched} / {s.episodes.length}</div>
        </div>
        <form method="POST" action="?/markSeason" style="display:contents">
          <input type="hidden" name="seasonNumber" value={s.seasonNumber} />
          <button class="season__checkall" type="submit" aria-label={`Tout cocher saison ${s.seasonNumber}`}>
            {seasonWatched === s.episodes.length ? '✓' : '○'}
          </button>
        </form>
        <span class="iconbtn" aria-hidden="true">▾</span>
      </div>
      <ul class="season__list">
        {#each s.episodes as ep (ep.episodeNumber)}
          <li>
            <form method="POST" action="?/markEpisode" style="display:contents">
              <input type="hidden" name="seasonNumber" value={ep.seasonNumber} />
              <input type="hidden" name="episodeNumber" value={ep.episodeNumber} />
              <input type="hidden" name="watched" value={ep.watched ? 'false' : 'true'} />
              <button
                type="submit"
                class="checkbox"
                aria-label={`Marquer ${formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)} ${ep.watched ? 'non vu' : 'vu'}`}
                aria-pressed={ep.watched}
                style={ep.watched ? 'background: var(--bw-black)' : ''}
              >{ep.watched ? '✓' : ''}</button>
            </form>
            <span class="ep-code">{formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)}</span>
            <span>{ep.name ?? `Épisode ${ep.episodeNumber}`}</span>
            <span class="ep-date">{ep.airDate ? formatDateShortFr(ep.airDate) : ''}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <div class="spacer"></div>
  <BottomNav current="search" />
</main>
