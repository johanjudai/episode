<script lang="ts">
  import type { PageProps } from './$types';
  import { beforeNavigate, goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { t } from '$lib/i18n';

  let { data }: PageProps = $props();
  const isTrending = $derived(data.q === '');

  /* Local mirror of the input so we can debounce navigation without
   * fighting SvelteKit's `data.q` (which only updates after the load
   * runs). When the server's `data.q` changes we sync the input —
   * BUT only when the user isn't actively typing in it, otherwise we
   * would yank characters from under their fingers as the goto resolves.
   *
   * Initializing from `data.q` is intentional (we want the input pre-
   * filled on SSR and on a fresh client navigation); the effect below
   * keeps it in sync for subsequent server data changes. */
  // svelte-ignore state_referenced_locally
  let query = $state(data.q);
  let inputEl: HTMLInputElement | undefined = $state();
  $effect(() => {
    const fresh = data.q;
    if (typeof document !== 'undefined' && inputEl && document.activeElement === inputEl) {
      return;
    }
    query = fresh;
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 320;

  function scheduleSearch(value: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const trimmed = value.trim();
      const target = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search';
      void goto(target, { keepFocus: true, replaceState: true, noScroll: true });
    }, DEBOUNCE_MS);
  }

  function onInput() {
    /* `query` is already updated by `bind:value` — just (re)schedule. */
    scheduleSearch(query);
  }

  function onSubmit(event: SubmitEvent) {
    /* Submit by Enter — bypass the debounce, fire immediately. */
    event.preventDefault();
    if (debounceTimer) clearTimeout(debounceTimer);
    const trimmed = query.trim();
    const target = trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search';
    void goto(target, { keepFocus: true, replaceState: true, noScroll: true });
  }

  /* Cancel any pending debounced search before a real navigation runs.
   * Without this, tapping a result while the 320 ms timer is still
   * counting fires a `goto('/search?…')` mid-flight that cancels the
   * navigation into the series — the "il faut recliquer" symptom. */
  beforeNavigate(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });
</script>

<svelte:head><title>{$t('search.title')}</title></svelte:head>

<main class="app">
  <header class="topbar">
    <h1 class="topbar__title">{$t('search.header')}</h1>
    <div class="topbar__date">
      {isTrending
        ? $t('search.discoverChip')
        : $t('search.resultsChip', { count: data.results.length })}
    </div>
  </header>

  <form class="search" onsubmit={onSubmit} data-sveltekit-keepfocus>
    <label class="sr-only" for="q">{$t('search.placeholder')}</label>
    <input
      bind:this={inputEl}
      class="search__input"
      type="text"
      inputmode="search"
      enterkeyhint="search"
      id="q"
      name="q"
      placeholder={$t('search.placeholder')}
      autocomplete="off"
      autocapitalize="off"
      bind:value={query}
      oninput={onInput}
    />
  </form>

  {#if !data.hasKey}
    <div class="empty">
      <div class="empty__title">{$t('search.noKeyTitle')}</div>
      <p style="margin-bottom: var(--s-4)">{$t('search.noKeyBody')}</p>
      <a class="btn btn--accent" href="/settings">{$t('search.openSettings')}</a>
    </div>
  {:else}
    <div class="section">
      <div class="section__title">
        {isTrending ? $t('search.trendingHeading') : $t('search.resultsHeading')}
        <span class="section__count">{$t('search.sourceChip')}</span>
      </div>
    </div>

    {#if data.results.length === 0}
      <div class="empty">
        <div class="empty__title">{$t('search.noResults')}</div>
        {$t('search.noResultsBody')}
      </div>
    {:else}
      {#each data.results as r, i (r.id)}
        <a
          class={isTrending ? 'series-card series-card--ranked' : 'series-card'}
          href={`/series/${r.id}`}
        >
          {#if isTrending}
            <span class="series-card__rank" aria-hidden="true"
              >{String(i + 1).padStart(2, '0')}</span
            >
          {/if}
          <div
            class={r.poster
              ? 'series-card__poster'
              : 'series-card__poster series-card__poster--placeholder'}
            style={r.poster ? `background-image:url('${r.poster}')` : ''}
            aria-hidden="true"
          ></div>
          <div>
            <div class="series-card__name">{r.name}</div>
            <div class="series-card__meta">{r.year ?? '—'} · TMDB</div>
          </div>
        </a>
      {/each}
    {/if}
  {/if}

  <div class="spacer"></div>
  <BottomNav current="search" />
</main>
