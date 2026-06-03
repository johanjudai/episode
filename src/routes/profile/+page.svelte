<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { formatEpisodeCode, formatTotalTime, initialOf } from '$lib/utils/format';
  import { t, locale, localeCode } from '$lib/i18n';

  let { data }: PageProps = $props();

  const total = $derived(formatTotalTime(data.stats.totalMinutes));
  const since = $derived(() => {
    if (!data.profile.createdAt) return '';
    const d = new Date(data.profile.createdAt);
    return d.toLocaleString(localeCode($locale), { month: 'long', year: 'numeric' });
  });
</script>

<svelte:head><title>{$t('profile.titleFull')}</title></svelte:head>

<main class="app">
  <header class="topbar">
    <h1 class="topbar__title">{$t('profile.title')}</h1>
    <a href="/settings" class="iconbtn iconbtn--blue" aria-label={$t('common.settings')}>⚙</a>
  </header>

  <section class="profile-head">
    <div class="profile-head__decor" aria-hidden="true">
      <span class="decor decor--circle"></span>
      <span class="decor decor--square"></span>
      <span class="decor decor--triangle"></span>
    </div>
    <div
      class="avatar"
      aria-hidden="true"
      style={data.profile.avatar ? `background-image: url('${data.profile.avatar}')` : ''}
    >
      {data.profile.avatar ? '' : initialOf(data.profile.name)}
    </div>
    <div class="profile-head__text">
      <div class="profile-head__name">{data.profile.name || $t('profile.defaultName')}</div>
      {#if data.profile.createdAt}
        <div class="profile-head__since">{$t('profile.memberSince', { date: since() })}</div>
      {/if}
    </div>
  </section>

  <section class="stats">
    <div class="stat">
      <div class="stat__num stat__accent">{total.value}<small>{total.unit}</small></div>
      <div class="stat__label">{$t('profile.totalTime')}</div>
    </div>
    <a
      class="stat stat--link"
      href="/series"
      aria-label={$t('profile.seriesFollowedAria', { count: data.stats.seriesCount })}
    >
      <div class="stat__num">{data.stats.seriesCount}</div>
      <div class="stat__label">{$t('profile.seriesFollowed')}</div>
    </a>
    <a
      class="stat stat--link"
      href="/history"
      aria-label={$t('profile.episodesWatchedAria', { count: data.stats.episodesWatched })}
    >
      <div class="stat__num">{data.stats.episodesWatched}</div>
      <div class="stat__label">{$t('profile.episodesWatched')}</div>
    </a>
    <a
      class="stat stat--link"
      href="/series"
      aria-label={$t('profile.animesFollowedAria', { count: data.stats.animeCount })}
    >
      <div class="stat__num">{data.stats.animeCount}</div>
      <div class="stat__label">{$t('profile.animesFollowed')}</div>
    </a>
  </section>

  {#if data.history.length > 0}
    <section>
      <div class="section">
        <div class="section__title">
          {$t('profile.recentHistory')}
          <a class="section__count" href="/history" style="text-decoration: none"
            >{$t('profile.seeAll')}</a
          >
        </div>
      </div>
      <ul class="history">
        {#each data.history.slice(0, 10) as h, i (h.episodeId)}
          {@const colorVariants = ['', 'history__dot--blue', 'history__dot--yellow']}
          <li>
            <span class={`history__dot ${colorVariants[i % 3]}`} aria-hidden="true"></span>
            <div>
              <strong>{h.seriesName}</strong> · {formatEpisodeCode(h.seasonNumber, h.episodeNumber)}
              <div class="ep-date">
                {new Date(h.watchedAt).toLocaleString(localeCode($locale), {
                  day: 'numeric',
                  month: 'short'
                })}
                {#if h.runtimeMinutes}· {h.runtimeMinutes} min{/if}
              </div>
            </div>
            <span class="history__time">
              {new Date(h.watchedAt).toLocaleTimeString(localeCode($locale), {
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
      <div class="empty__title">{$t('profile.emptyTitle')}</div>
      {$t('profile.emptyBody')}
    </div>
  {/if}

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
