<script lang="ts">
  /**
   * Wraps content with four discreet Art Nouveau corner flourishes.
   *
   * The source SVG (static/ornaments/corner.svg, CC0 from Wikimedia
   * Commons — "Corner Ornament Black Down Left") is anchored at the
   * bottom-left of its viewBox. The other three corners are obtained
   * via CSS `transform: scale*(-1)`.
   *
   * Ornaments are visible only when `[data-palette='artnouveau']` is
   * active. Other palettes treat this component as a transparent
   * pass-through wrapper — no markup is added by SVG, no styling shifts.
   */
  interface Props {
    children: import('svelte').Snippet;
  }
  let { children }: Props = $props();

  const corners = [{ name: 'tl' }, { name: 'tr' }, { name: 'bl' }, { name: 'br' }] as const;
</script>

<div class="ornate">
  {#each corners as c (c.name)}
    <span class={`ornate__corner ornate__corner--${c.name}`} aria-hidden="true"></span>
  {/each}
  {@render children()}
</div>

<style>
  .ornate {
    position: relative;
  }

  /* Hidden by default — every non-art-nouveau palette sees a clean
   * pass-through wrapper. */
  .ornate__corner {
    display: none;
  }

  /* When the art-nouveau palette is on, the wrapper gets a small
   * padding so the four corner ornaments sit in a band of empty space
   * around the framed content rather than overlapping its text. */
  :global([data-palette='artnouveau']) .ornate {
    padding: 6px;
  }

  /* Mask-image lets the underlying svg act as a stencil — the colour
   * comes from `background-color` so it can follow the theme tint
   * (gold in light, copper in dark) without baking it into the file.
   * `currentColor` would only work for inline SVG. */
  :global([data-palette='artnouveau']) .ornate__corner {
    display: block;
    position: absolute;
    width: 52px;
    height: 52px;
    background-color: var(--bw-yellow);
    -webkit-mask-image: url('/ornaments/corner.svg');
    mask-image: url('/ornaments/corner.svg');
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: contain;
    mask-size: contain;
    pointer-events: none;
    opacity: 0.68;
  }

  /* Source ornament is oriented for the bottom-left corner; the other
   * three reuse it via mirror transforms. */
  :global([data-palette='artnouveau']) .ornate__corner--bl {
    bottom: 6px;
    left: 6px;
  }
  :global([data-palette='artnouveau']) .ornate__corner--br {
    bottom: 6px;
    right: 6px;
    transform: scaleX(-1);
  }
  :global([data-palette='artnouveau']) .ornate__corner--tl {
    top: 6px;
    left: 6px;
    transform: scaleY(-1);
  }
  :global([data-palette='artnouveau']) .ornate__corner--tr {
    top: 6px;
    right: 6px;
    transform: scale(-1);
  }

  /* On modals, nudge the ornaments inside the rounded edge. */
  :global([data-palette='artnouveau'] .modal) .ornate__corner {
    width: 44px;
    height: 44px;
  }
</style>
