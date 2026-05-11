<script lang="ts">
  import type { PageProps } from './$types';
  import { enhance, deserialize, applyAction } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { slide, scale, fade } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDateShortFr } from '$lib/utils/date';
  import { posterUrl } from '$lib/utils/images';
  import { countUnwatchedBefore, findInProgressSeason } from '$lib/utils/episodes';

  let { data }: PageProps = $props();

  const percent = $derived(
    data.progress.total > 0 ? Math.round((data.progress.watched / data.progress.total) * 100) : 0
  );

  const heroStyle = $derived(
    data.series.posterPath
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

  type PendingForm = {
    action: 'markEpisode' | 'markSeason';
    formData: FormData;
    title: string;
    body: string;
  };
  let pending = $state<PendingForm | null>(null);

  async function submitWithFetch(action: string, formData: FormData) {
    const res = await fetch(`?/${action}`, { method: 'POST', body: formData });
    const result = deserialize(await res.text()) as Parameters<typeof applyAction>[0];
    await applyAction(result);
    if (result.type !== 'failure') await invalidateAll();
  }

  function interceptEpisode({ formData, cancel }: { formData: FormData; cancel: () => void }) {
    const willBeWatched = formData.get('watched') === 'true';
    if (!willBeWatched) return;
    const s = Number(formData.get('seasonNumber'));
    const e = Number(formData.get('episodeNumber'));
    const count = countUnwatchedBefore(data.seasons, s, e);
    if (count === 0) return;
    cancel();
    pending = {
      action: 'markEpisode',
      formData,
      title: 'Marquer aussi les épisodes précédents ?',
      body: `${count} épisode${count > 1 ? 's' : ''} avant ${formatEpisodeCode(s, e)} ${
        count > 1 ? 'sont' : 'est'
      } non vu${count > 1 ? 's' : ''}.`
    };
  }

  function interceptSeason({ formData, cancel }: { formData: FormData; cancel: () => void }) {
    /* Unticking a fully-watched season is always immediate — no confirmation. */
    if (formData.get('watched') !== 'true') return;
    const s = Number(formData.get('seasonNumber'));
    const count = countUnwatchedBefore(data.seasons, s);
    if (count === 0) return;
    cancel();
    pending = {
      action: 'markSeason',
      formData,
      title: 'Marquer aussi les saisons précédentes ?',
      body: `${count} épisode${count > 1 ? 's' : ''} dans les saisons antérieures ${
        count > 1 ? 'sont' : 'est'
      } non vu${count > 1 ? 's' : ''}.`
    };
  }

  async function confirmMarkAllUpTo() {
    if (!pending) return;
    pending.formData.set('markPrevious', 'true');
    await submitWithFetch(pending.action, pending.formData);
    pending = null;
  }

  async function confirmOnlyThis() {
    if (!pending) return;
    pending.formData.set('markPrevious', 'false');
    await submitWithFetch(pending.action, pending.formData);
    pending = null;
  }

  function cancelPending() {
    pending = null;
  }
</script>

<svelte:head><title>{data.series.name} — Episode</title></svelte:head>

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
    <div class="progress__bar" role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
      <div class="progress__fill" style="width: {percent}%"></div>
    </div>
    <div class="progress__numbers">
      {data.progress.watched}<small>/ {data.progress.total} épisodes</small>
    </div>
  </section>

  <section class="actions">
    {#if data.followed}
      <form method="POST" action="?/markAll" use:enhance>
        <button class="btn btn--accent btn--block" type="submit">Tout cocher</button>
      </form>
      <form method="POST" action="?/unfollow" use:enhance>
        <button class="btn btn--secondary btn--block" type="submit">Retirer du suivi</button>
      </form>
    {:else}
      <form method="POST" action="?/follow" use:enhance style="grid-column: 1 / -1">
        <button class="btn btn--accent btn--block" type="submit">Suivre cette série</button>
      </form>
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
        <form method="POST" action="?/markSeason" use:enhance={interceptSeason} style="display:contents">
          <input type="hidden" name="seasonNumber" value={s.seasonNumber} />
          <input type="hidden" name="watched" value={isComplete ? 'false' : 'true'} />
          <button
            class="season__checkall"
            type="submit"
            aria-label={isComplete
              ? `Décocher saison ${s.seasonNumber}`
              : `Tout cocher saison ${s.seasonNumber}`}
            aria-pressed={isComplete}
          >{isComplete ? '✓' : '○'}</button>
        </form>
        <button
          class="iconbtn"
          type="button"
          aria-label={isExpanded ? `Replier la saison ${s.seasonNumber}` : `Déplier la saison ${s.seasonNumber}`}
          aria-expanded={isExpanded}
          onclick={() => toggleSeason(s.seasonNumber)}
        >{isExpanded ? '▴' : '▾'}</button>
      </div>
      {#if isExpanded}
        <ul class="season__list" transition:slide={{ duration: 220, easing: quintOut }}>
          {#each s.episodes as ep (ep.episodeNumber)}
            <li>
              <form method="POST" action="?/markEpisode" use:enhance={interceptEpisode} style="display:contents">
                <input type="hidden" name="seasonNumber" value={ep.seasonNumber} />
                <input type="hidden" name="episodeNumber" value={ep.episodeNumber} />
                <input type="hidden" name="watched" value={ep.watched ? 'false' : 'true'} />
                <button
                  type="submit"
                  class="checkbox"
                  aria-label={`Marquer ${formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)} ${ep.watched ? 'non vu' : 'vu'}`}
                  aria-pressed={ep.watched}
                  style={ep.watched ? 'background: var(--bw-black); color: var(--bw-white)' : ''}
                >{ep.watched ? '✓' : ''}</button>
              </form>
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
        <button class="btn btn--secondary" type="button" onclick={confirmOnlyThis}>Seulement celui-ci</button>
        <button class="btn btn--accent" type="button" onclick={confirmMarkAllUpTo}>Tout marquer</button>
      </div>
      <button class="btn btn--secondary btn--block" type="button" onclick={cancelPending} style="margin-top: var(--s-2)">
        Annuler
      </button>
    </div>
  </div>
{/if}
