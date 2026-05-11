<script lang="ts">
  import type { PageProps } from './$types';
  import { deserialize, applyAction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Mark from '$lib/components/Mark.svelte';
  import EpisodeRow from '$lib/components/EpisodeRow.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDayShortFr, formatDateShortFr, relativeFr } from '$lib/utils/date';

  let { data }: PageProps = $props();

  const today = $derived(new Date(data.now));
  const todayLabel = $derived(formatDateShortFr(today));

  let removeModal = $state<null | { seriesTmdbId: number; seriesName: string }>(null);

  async function postAction(action: string, fd: FormData) {
    const res = await fetch(`?/${action}`, { method: 'POST', body: fd });
    const result = deserialize(await res.text()) as Parameters<typeof applyAction>[0];
    await applyAction(result);
    if (result.type !== 'failure') await invalidateAll();
  }

  async function markEpisode(episodeId: number) {
    const fd = new FormData();
    fd.set('episodeId', String(episodeId));
    await postAction('markWatched', fd);
  }

  function requestUnfollow(seriesTmdbId: number, seriesName: string) {
    removeModal = { seriesTmdbId, seriesName };
  }

  async function confirmUnfollow() {
    if (!removeModal) return;
    const fd = new FormData();
    fd.set('seriesTmdbId', String(removeModal.seriesTmdbId));
    removeModal = null;
    await postAction('unfollowSeries', fd);
  }

  function cancelUnfollow() {
    removeModal = null;
  }
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
          onSwipeRight={() => markEpisode(ep.id)}
          onSwipeLeft={() => requestUnfollow(ep.seriesTmdbId, ep.seriesName)}
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

{#if removeModal}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="remove-title"
    transition:fade={{ duration: 140 }}
  >
    <div class="modal" transition:scale={{ duration: 260, start: 0.92, easing: backOut }}>
      <div class="modal__kicker">Confirmation</div>
      <h2 class="modal__title" id="remove-title">Retirer {removeModal.seriesName} de votre suivi ?</h2>
      <p class="modal__body">
        Vos épisodes déjà vus restent dans l'historique. Vous pouvez réajouter la série à tout moment.
      </p>
      <div class="modal__actions">
        <button class="btn btn--secondary" type="button" onclick={cancelUnfollow}>Annuler</button>
        <button class="btn btn--accent" type="button" onclick={confirmUnfollow}>Retirer</button>
      </div>
    </div>
  </div>
{/if}
