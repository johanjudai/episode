<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Mark from '$lib/components/Mark.svelte';
  import EpisodeRow from '$lib/components/EpisodeRow.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDayShortFr, formatDateShortFr, relativeFr } from '$lib/utils/date';

  let { data }: PageProps = $props();

  const today = $derived(new Date(data.now));
  const todayLabel = $derived(formatDateShortFr(today));
</script>

<svelte:head><title>À voir — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <div>
      <Mark />
      <h1 class="topbar__title" style="margin-top: 8px">Episode</h1>
    </div>
    <div style="text-align: right">
      <div class="topbar__date">{todayLabel}</div>
    </div>
  </header>

  <section>
    <div class="section">
      <div class="section__title">
        À voir maintenant
        <span class="section__count">{data.toWatch.length}</span>
      </div>
    </div>

    {#if data.toWatch.length === 0}
      <div class="empty">
        <div class="empty__title">Tout est à jour</div>
        Revenez demain pour de nouveaux épisodes.
      </div>
    {:else}
      <div class="swipe-hint">→ Droite : vu &nbsp;·&nbsp; ← Gauche : retirer la série</div>
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
        />
      {/each}
    {/if}
  </section>

  {#if data.upcoming.length > 0}
    <section>
      <div class="section">
        <div class="section__title">
          À venir
          <span class="section__count">7 jours</span>
        </div>
      </div>
      <div class="upcoming">
        {#each data.upcoming as ep (ep.id)}
          {@const d = formatDayShortFr(ep.airDate ?? '')}
          <div class="upcoming__row">
            <div class="upcoming__day" aria-hidden="true">{d.weekday}<strong>{d.day}</strong></div>
            <div>
              <div class="episode__series">{ep.seriesName}</div>
              <h3 class="episode__title">{ep.name ?? `Épisode ${ep.episodeNumber}`}</h3>
              <div class="episode__meta">{formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)}</div>
            </div>
            <span class="ep-date">{relativeFr(ep.airDate ?? '', today)}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <div class="spacer"></div>
  <BottomNav current="home" />
</main>
