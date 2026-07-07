<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import { formatEpisodeCode } from '$lib/utils/format';
  import { formatDateShortFr } from '$lib/utils/date';
  import { stillUrl } from '$lib/utils/images';
  import { t } from '$lib/i18n';
  import { pushBackInterceptor } from '$lib/native/back';
  import OrnateFrame from './OrnateFrame.svelte';

  interface Props {
    seriesName: string;
    /** When set, the series name links to that series' detail page. */
    seriesTmdbId?: number | null;
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
    overview: string | null;
    airDate: string | null;
    runtimeMinutes: number | null;
    stillPath: string | null;
    watched?: boolean;
    onClose: () => void;
  }
  let {
    seriesName,
    seriesTmdbId = null,
    seasonNumber,
    episodeNumber,
    name,
    overview,
    airDate,
    runtimeMinutes,
    stillPath,
    watched = false,
    onClose
  }: Props = $props();

  const still = $derived(stillUrl(stillPath, 'w500'));

  /* Android back button / swipe closes the modal instead of navigating. */
  onMount(() =>
    pushBackInterceptor(() => {
      onClose();
      return true;
    })
  );
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="ep-modal-title"
  tabindex="-1"
  transition:fade={{ duration: 140 }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
>
  <div
    class="modal modal--episode"
    transition:scale={{ duration: 260, start: 0.92, easing: backOut }}
  >
    <OrnateFrame>
      {#if still}
        <div class="modal__still" style="background-image: url('{still}')"></div>
      {:else}
        <div class="modal__still modal__still--placeholder">
          {formatEpisodeCode(seasonNumber, episodeNumber)}
        </div>
      {/if}
      <div class="modal__inner">
        {#if seriesTmdbId != null}
          <a
            class="modal__kicker modal__kicker--link"
            href={`/series/${seriesTmdbId}`}
            onclick={onClose}
            aria-label={$t('series.viewSeriesAria', { name: seriesName })}>{seriesName}</a
          >
        {:else}
          <div class="modal__kicker">{seriesName}</div>
        {/if}
        <h2 class="modal__title" id="ep-modal-title">
          {name ?? `Episode ${episodeNumber}`}
        </h2>
        <div class="modal__meta">
          <span class="ep-code">{formatEpisodeCode(seasonNumber, episodeNumber)}</span>
          {#if airDate}
            <span>{formatDateShortFr(airDate)}</span>
          {/if}
          {#if runtimeMinutes}
            <span>· {runtimeMinutes} min</span>
          {/if}
          {#if watched}
            <span style="color: var(--bw-green); font-weight: 800">{$t('series.watchedBadge')}</span
            >
          {/if}
        </div>
        <p class="modal__body modal__body--prose">
          {overview ?? $t('series.noSynopsis')}
        </p>
        <div class="modal__actions">
          <button class="btn btn--secondary btn--block" type="button" onclick={onClose}
            >{$t('common.close')}</button
          >
        </div>
      </div>
    </OrnateFrame>
  </div>
</div>
