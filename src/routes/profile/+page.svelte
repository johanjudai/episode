<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { formatEpisodeCode, formatTotalTime, initialOf } from '$lib/utils/format';

  let { data }: PageProps = $props();

  const t = $derived(formatTotalTime(data.stats.totalMinutes));
  const since = $derived(() => {
    if (!data.profile.createdAt) return '';
    const d = new Date(data.profile.createdAt);
    return d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  });
</script>

<svelte:head><title>Profil — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <h1 class="topbar__title">Profil</h1>
    <a href="/settings" class="iconbtn" aria-label="Paramètres">⚙</a>
  </header>

  <section class="profile-head">
    <div
      class="avatar"
      aria-hidden="true"
      style={data.profile.avatar ? `background-image: url('${data.profile.avatar}')` : ''}
    >
      {data.profile.avatar ? '' : initialOf(data.profile.name)}
    </div>
    <div>
      <div class="profile-head__name">{data.profile.name}</div>
      {#if data.profile.createdAt}
        <div class="profile-head__since">Membre depuis {since()}</div>
      {/if}
    </div>
  </section>

  <section class="stats">
    <div class="stat">
      <div class="stat__num stat__accent">{t.value}<small>{t.unit}</small></div>
      <div class="stat__label">Temps total</div>
    </div>
    <div class="stat">
      <div class="stat__num">{data.stats.seriesCount}</div>
      <div class="stat__label">Séries suivies</div>
    </div>
    <div class="stat">
      <div class="stat__num">{data.stats.episodesWatched}</div>
      <div class="stat__label">Épisodes vus</div>
    </div>
    <div class="stat">
      <div class="stat__num">—</div>
      <div class="stat__label">Streak</div>
    </div>
  </section>

  {#if data.history.length > 0}
    <section>
      <div class="section">
        <div class="section__title">Historique récent</div>
      </div>
      <ul class="history">
        {#each data.history as h, i (h.episodeId)}
          {@const colorVariants = ['', 'history__dot--blue', 'history__dot--yellow']}
          <li>
            <span class={`history__dot ${colorVariants[i % 3]}`} aria-hidden="true"></span>
            <div>
              <strong>{h.seriesName}</strong> · {formatEpisodeCode(h.seasonNumber, h.episodeNumber)}
              <div class="ep-date">
                {new Date(h.watchedAt).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'short'
                })}
                {#if h.runtimeMinutes}· {h.runtimeMinutes} min{/if}
              </div>
            </div>
            <span class="history__time">
              {new Date(h.watchedAt).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <div class="empty">
      <div class="empty__title">Pas encore d'historique</div>
      Marquez votre premier épisode comme vu.
    </div>
  {/if}

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
