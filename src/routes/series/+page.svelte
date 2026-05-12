<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { posterUrl } from '$lib/utils/images';

  let { data }: PageProps = $props();
</script>

<svelte:head><title>Mes séries — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <a class="iconbtn" href="/profile" aria-label="Retour">←</a>
    <h1 class="topbar__title">Mes séries</h1>
    <div class="topbar__date">{data.series.length}</div>
  </header>

  {#if data.series.length === 0}
    <div class="empty">
      <div class="empty__title">Aucune série suivie</div>
      <p style="margin-bottom: var(--s-4)">Ajoutez votre première série depuis la recherche.</p>
      <a class="btn btn--accent" href="/search">Découvrir</a>
    </div>
  {:else}
    {#each data.series as s (s.tmdbId)}
      {@const percent =
        s.totalEpisodes > 0 ? Math.round((s.watchedCount / s.totalEpisodes) * 100) : 0}
      <a class="series-card" href={`/series/${s.tmdbId}`}>
        <div
          class={s.posterPath
            ? 'series-card__poster'
            : 'series-card__poster series-card__poster--placeholder'}
          style={s.posterPath ? `background-image:url('${posterUrl(s.posterPath, 'w185')}')` : ''}
          aria-hidden="true"
        ></div>
        <div>
          <div class="series-card__name">{s.name}</div>
          <div class="series-card__meta">
            {s.firstAirDate?.slice(0, 4) ?? '—'}
            {#if s.numberOfSeasons}· {s.numberOfSeasons} saisons{/if}
            · {s.watchedCount} / {s.totalEpisodes}
          </div>
          <div
            class="progress__bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin="0"
            aria-valuemax="100"
            style="margin-top: var(--s-2); height: 4px"
          >
            <div class="progress__fill" style="width: {percent}%"></div>
          </div>
        </div>
      </a>
    {/each}
  {/if}

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
