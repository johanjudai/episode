<script lang="ts">
  /**
   * Editorial Art Nouveau section divider. A small horizontal ornament
   * (static/ornaments/divider.svg — Public Domain Portuguese 1901
   * `Serões` magazine separator) tinted via mask-image.
   *
   * Visible only when `[data-palette='artnouveau']` is active. Other
   * palettes render this as a thin transparent spacer so the rhythm
   * of the page is preserved across palettes without adding new
   * dividers everywhere.
   */
</script>

<div class="floral-divider" aria-hidden="true"></div>

<style>
  .floral-divider {
    /* Inert by default — vertical rhythm only. */
    height: var(--s-3);
  }

  :global([data-palette='artnouveau']) .floral-divider {
    height: 26px;
    width: min(320px, 78%);
    margin: var(--s-4) auto;
    background-color: var(--bw-yellow);
    -webkit-mask-image: url('/ornaments/divider.svg');
    mask-image: url('/ornaments/divider.svg');
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    opacity: 0.7;
  }
</style>
