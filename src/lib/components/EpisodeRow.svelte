<script lang="ts">
  import { formatEpisodeCode, formatRuntime, seriesInitials } from '$lib/utils/format';
  import { posterUrl } from '$lib/utils/images';
  import { swipeable } from '$lib/actions/swipe';

  interface Props {
    episodeId: number;
    seriesTmdbId: number;
    seriesName: string;
    seriesPoster?: string | null;
    episodeName: string | null;
    seasonNumber: number;
    episodeNumber: number;
    runtimeMinutes?: number | null;
    coverVariant?: '' | 'red' | 'blue';
    onSwipeRight: () => void;
    onSwipeLeft: () => void;
  }
  /* `episodeId` is part of the prop contract (callers pass it for clarity)
   * but the component itself uses only the callbacks. Underscore-prefixed to
   * silence the unused-vars lint rule. */
  let {
    episodeId: _episodeId,
    seriesTmdbId,
    seriesName,
    seriesPoster,
    episodeName,
    seasonNumber,
    episodeNumber,
    runtimeMinutes,
    coverVariant = '',
    onSwipeRight,
    onSwipeLeft
  }: Props = $props();

  const posterCss = $derived(
    seriesPoster ? `background-image:url('${posterUrl(seriesPoster, 'w185')}')` : ''
  );
  const coverClass = $derived(
    coverVariant ? `episode__cover episode__cover--${coverVariant}` : 'episode__cover'
  );

  let dx = $state(0);
  const showLeftReveal = $derived(dx > 24);
  const showRightReveal = $derived(dx < -24);
  const leftActive = $derived(dx > 70);
  const rightActive = $derived(dx < -70);
</script>

<div class="swipe-row">
  <div
    class="swipe-reveal swipe-reveal--left"
    class:swipe-reveal--visible={showLeftReveal}
    class:swipe-reveal--active={leftActive}
    aria-hidden="true"
  >
    <span>✓ Vu</span>
  </div>
  <div
    class="swipe-reveal swipe-reveal--right"
    class:swipe-reveal--visible={showRightReveal}
    class:swipe-reveal--active={rightActive}
    aria-hidden="true"
  >
    <span>Retirer ✕</span>
  </div>

  <div
    class="swipe-content"
    use:swipeable={{
      onSwipeRight,
      onSwipeLeft,
      onProgress: (px) => (dx = px),
      flyOutOnRight: true
    }}
  >
    <div class="episode">
      <a class={coverClass} href={`/series/${seriesTmdbId}`} aria-hidden="true" style={posterCss}>
        {#if !seriesPoster}{seriesInitials(seriesName)}{/if}
      </a>
      <div>
        <div class="episode__series">{seriesName}</div>
        <h3 class="episode__title">{episodeName ?? `Épisode ${episodeNumber}`}</h3>
        <div class="episode__meta">
          {formatEpisodeCode(seasonNumber, episodeNumber)}
          {#if runtimeMinutes}· {formatRuntime(runtimeMinutes)}{/if}
        </div>
      </div>
      <button
        class="episode__action"
        type="button"
        onclick={onSwipeRight}
        aria-label={`Marquer vu : ${seriesName} ${formatEpisodeCode(seasonNumber, episodeNumber)}`}
        >✓</button
      >
    </div>
  </div>
</div>
