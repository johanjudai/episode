<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';

  let { data }: PageProps = $props();

  /* Group entries by ISO date (YYYY-MM-DD) for sectioned rendering. */
  const groups = $derived.by(() => {
    const map = new Map<string, Array<(typeof data.history)[number]>>();
    for (const row of data.history) {
      const day = new Date(row.watchedAt).toISOString().slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(row);
      map.set(day, arr);
    }
    return [...map.entries()].map(([day, rows]) => ({ day, rows }));
  });

  const today = $derived(new Date(data.now));

  function dayLabel(day: string): string {
    const todayIso = today.toISOString().slice(0, 10);
    if (day === todayIso) return "Aujourd'hui";
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    if (day === y.toISOString().slice(0, 10)) return 'Hier';
    return new Date(`${day}T00:00:00Z`).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function hm(ms: number | string | Date): string {
    return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<svelte:head><title>Historique — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <a class="iconbtn" href="/profile" aria-label="Retour">←</a>
    <h1 class="topbar__title">Historique</h1>
    <div class="topbar__date">{data.history.length}</div>
  </header>

  {#if data.history.length === 0}
    <div class="empty">
      <div class="empty__title">Pas encore d'historique</div>
      Marquez votre premier épisode comme vu depuis l'accueil.
    </div>
  {:else}
    {#each groups as g (g.day)}
      <section>
        <div class="section">
          <div class="section__title">
            {dayLabel(g.day)}
            <span class="section__count">{g.rows.length}</span>
          </div>
        </div>
        <ul class="history">
          {#each g.rows as r (r.episodeId)}
            <li>
              <span class="history__dot" aria-hidden="true"></span>
              <div>
                <a href={`/series/${r.seriesTmdbId}`} style="text-decoration: none; color: inherit">
                  <strong>{r.seriesName}</strong> · {formatEpisodeCode(
                    r.seasonNumber,
                    r.episodeNumber
                  )}
                </a>
                <div class="ep-date">
                  {r.episodeName ?? `Épisode ${r.episodeNumber}`}
                  {#if r.runtimeMinutes}· {r.runtimeMinutes} min{/if}
                </div>
              </div>
              <span class="history__time">{hm(r.watchedAt)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
