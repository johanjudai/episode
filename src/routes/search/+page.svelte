<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';

  let { data }: PageProps = $props();
  const isTrending = $derived(data.q === '');
</script>

<svelte:head><title>Recherche — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <h1 class="topbar__title">Recherche</h1>
    <div class="topbar__date">
      {isTrending ? 'Découvrir' : `${data.results.length} résultats`}
    </div>
  </header>

  <form class="search" method="GET" data-sveltekit-keepfocus>
    <label class="sr-only" for="q">Rechercher une série</label>
    <input
      class="search__input"
      type="search"
      id="q"
      name="q"
      placeholder="Rechercher une série..."
      value={data.q}
    />
  </form>

  {#if !data.hasKey}
    <div class="empty">
      <div class="empty__title">Clé TMDB manquante</div>
      <p style="margin-bottom: var(--s-4)">
        Ajoutez votre clé TMDB pour rechercher des séries et voir les tendances.
      </p>
      <a class="btn btn--accent" href="/settings">Ouvrir les paramètres</a>
    </div>
  {:else}
    <div class="section">
      <div class="section__title">
        {isTrending ? 'Tendances cette semaine' : 'Résultats'}
        <span class="section__count">TMDB</span>
      </div>
    </div>

    {#if data.results.length === 0}
      <div class="empty">
        <div class="empty__title">Aucun résultat</div>
        Essayez un autre titre.
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
