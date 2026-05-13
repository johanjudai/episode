<script lang="ts">
  import type { PageProps } from './$types';
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Mark from '$lib/components/Mark.svelte';
  import EpisodeRow from '$lib/components/EpisodeRow.svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDayShortFr, formatDateShortFr, relativeFr } from '$lib/utils/date';
  import * as api from '$lib/api';
  import type { WatchedRow } from '$lib/data/queries';

  let { data }: PageProps = $props();

  const today = $derived(new Date(data.now));
  const todayLabel = $derived(formatDateShortFr(today));

  let removeModal = $state<null | { seriesTmdbId: number; seriesName: string }>(null);

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

  function relativeRecent(ms: number, now: Date): string {
    const diff = Math.max(0, now.getTime() - ms);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "À l'instant";
    if (mins < 60) return `Il y a ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Il y a ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Hier';
    if (days < 7) return `Il y a ${days} j`;
    return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  /* ──────────────────────────────────────────────────────────────
   * Timeline: past flows up, future flows down
   * ──────────────────────────────────────────────────────────────
   * The page is a vertical timeline. "À voir maintenant" is the
   * anchor — we scroll the user there on mount. Above it, the
   * "Vu récemment" section sits with items in CHRONO-ASC order
   * (oldest at top, most recently watched just before À voir).
   * Below À voir, "À venir" lists future episodes. Scroll up =
   * past, scroll down = future.
   *
   * Pagination: 5 items loaded initially. An IntersectionObserver
   * on a sentinel at the top of the recent list fetches the next
   * 5 older entries when the user scrolls up to that boundary.
   * Scroll position is preserved by anchoring on `scrollHeight -
   * scrollY` before/after prepending — otherwise the viewport
   * jumps as new rows appear above. */

  /* Display order: newest at the bottom (closest to À voir), oldest
   * at the top. The query returns DESC by watchedAt; we reverse for
   * the timeline metaphor.
   *
   *  - `baseRows` is derived from the server-fetched first page;
   *    it auto-updates after `invalidateAll()`.
   *  - `extraRows` holds older items loaded via the scroll-up
   *    pagination. Reset to [] whenever `data.recent` changes,
   *    so a freshly-marked episode doesn't create duplicates with
   *    a stale paginated tail. */
  let baseRows = $derived([...data.recent].reverse());
  let extraRows = $state<WatchedRow[]>([]);
  let loadingMore = $state(false);
  /* `paginationExhausted` flips to true only after a fetch returns fewer
   * than the requested batch. We OR it with "first page didn't fill",
   * so `allLoaded` is the single source of truth in the template. */
  let paginationExhausted = $state(false);
  let allLoaded = $derived(data.recent.length < 5 || paginationExhausted);
  let recentRows = $derived([...extraRows, ...baseRows]);

  $effect(() => {
    /* Track data.recent — reset pagination on every refetch. */
    void data.recent;
    extraRows = [];
    paginationExhausted = false;
  });

  let toWatchRef: HTMLElement | undefined = $state();
  let recentTopSentinel: HTMLElement | undefined = $state();

  async function loadOlder() {
    if (loadingMore || allLoaded) return;
    loadingMore = true;
    try {
      const batch = await api.fetchRecent(recentRows.length, 5);
      if (batch.length === 0) {
        paginationExhausted = true;
        return;
      }
      /* Preserve the scroll position: capture the distance from the
       * top of the viewport to the BOTTOM of the document, then
       * restore it after the new rows have been prepended. The
       * visible content under the user's eye stays put. */
      const root = document.documentElement;
      const offsetFromBottom = root.scrollHeight - window.scrollY;
      /* Newest first in batch (DESC). Reversed and prepended so the
       * OLDER item ends up at the very top. */
      extraRows = [...batch.slice().reverse(), ...extraRows];
      if (batch.length < 5) paginationExhausted = true;
      await tick();
      window.scrollTo({ top: root.scrollHeight - offsetFromBottom });
    } finally {
      loadingMore = false;
    }
  }

  onMount(() => {
    let io: IntersectionObserver | undefined;
    /* onMount cannot be async if we also need a cleanup return, so
     * we kick off the setup work asynchronously and let the cleanup
     * close over `io`. */
    void (async () => {
      await tick();
      /* Initial scroll: position "À voir maintenant" at the top of the
       * viewport (just under the sticky topbar). Done in two ticks
       * because layout shifts after fonts load can change geometry. */
      function settle() {
        if (!toWatchRef) return;
        const top = window.scrollY + toWatchRef.getBoundingClientRect().top;
        // eslint-disable-next-line no-undef
        window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
      }
      settle();
      requestAnimationFrame(settle);

      if (recentTopSentinel && recentRows.length > 0 && !allLoaded) {
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) void loadOlder();
            }
          },
          { rootMargin: '200px 0px 0px 0px' }
        );
        io.observe(recentTopSentinel);
      }
    })();
    return () => io?.disconnect();
  });
</script>

<svelte:head><title>À voir — Episode</title></svelte:head>

<main class="app">
  <header class="topbar topbar--sticky">
    <div>
      <Mark />
      <h1 class="topbar__title" style="margin-top: 8px">Episode</h1>
    </div>
    <div style="text-align: right">
      <div class="topbar__date">{todayLabel}</div>
    </div>
  </header>

  {#if recentRows.length > 0}
    <section class="home-section home-section--recent">
      <div bind:this={recentTopSentinel} class="timeline-sentinel" aria-hidden="true"></div>
      {#if loadingMore}
        <div class="timeline-loader" aria-live="polite">Chargement…</div>
      {/if}
      <ul class="history history--compact">
        {#each recentRows as r (r.episodeId)}
          <li>
            <span class="history__dot" aria-hidden="true"></span>
            <a
              class="history__line"
              href={`/series/${r.seriesTmdbId}`}
              style="text-decoration: none; color: inherit"
            >
              <strong>{r.seriesName}</strong>
              <span class="history__code">{formatEpisodeCode(r.seasonNumber, r.episodeNumber)}</span
              >
            </a>
            <span class="history__time"
              >{relativeRecent(new Date(r.watchedAt).getTime(), today)}</span
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section bind:this={toWatchRef} class="home-section home-section--now">
    {#if recentRows.length > 0}
      <div class="timeline-marker timeline-marker--up" aria-hidden="true">
        <span>↑ Épisodes précédents</span>
      </div>
    {/if}
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
    <section class="home-section home-section--upcoming">
      <div class="timeline-marker timeline-marker--down" aria-hidden="true">
        <span>↓ À venir cette semaine</span>
      </div>
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
              <div class="episode__meta">
                {formatEpisodeCode(ep.seasonNumber, ep.episodeNumber)}
              </div>
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
      <h2 class="modal__title" id="remove-title">
        Retirer {removeModal.seriesName} de votre suivi ?
      </h2>
      <p class="modal__body">
        Vos épisodes déjà vus restent dans l'historique. Vous pouvez réajouter la série à tout
        moment.
      </p>
      <div class="modal__actions">
        <button class="btn btn--secondary" type="button" onclick={cancelUnfollow}>Annuler</button>
        <button class="btn btn--accent" type="button" onclick={confirmUnfollow}>Retirer</button>
      </div>
    </div>
  </div>
{/if}
