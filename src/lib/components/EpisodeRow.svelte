<script lang="ts">
  import { formatEpisodeCode, formatRuntime, seriesInitials } from '$lib/utils/format';
  import { posterUrl } from '$lib/utils/images';

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
  }
  let {
    episodeId,
    seriesTmdbId,
    seriesName,
    seriesPoster,
    episodeName,
    seasonNumber,
    episodeNumber,
    runtimeMinutes,
    coverVariant = ''
  }: Props = $props();

  const posterCss = $derived(seriesPoster ? `background-image:url('${posterUrl(seriesPoster, 'w185')}')` : '');
  const coverClass = $derived(coverVariant ? `episode__cover episode__cover--${coverVariant}` : 'episode__cover');
</script>

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
  <form method="POST" action="/?/markWatched" style="display:contents">
    <input type="hidden" name="episodeId" value={episodeId} />
    <button class="episode__action" type="submit" aria-label={`Marquer vu : ${seriesName} ${formatEpisodeCode(seasonNumber, episodeNumber)}`}>✓</button>
  </form>
</div>
