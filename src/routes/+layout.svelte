<script lang="ts">
  import '../app.css';
  import { setLocale } from '$lib/i18n';
  interface Props {
    data?: { locale?: 'fr' | 'en' };
    children: import('svelte').Snippet;
  }
  let { data, children }: Props = $props();

  /* Keep the i18n store in sync with whatever the layout load resolved.
   * Re-runs whenever invalidateAll() refreshes the data. */
  $effect(() => {
    if (data?.locale) setLocale(data.locale);
  });
</script>

<svelte:head>
  <script>
    (function () {
      try {
        var t = localStorage.getItem('episode.theme') || 'auto';
        var dark =
          t === 'dark' ||
          (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        var palette = localStorage.getItem('episode.palette');
        if (palette === 'ecobrutalism' || palette === 'bauhaus' || palette === 'artnouveau') {
          document.documentElement.dataset.palette = palette;
        } else {
          document.documentElement.dataset.palette = 'bauhaus';
        }
        var motion = localStorage.getItem('episode.motion');
        if (motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
        var contrast = localStorage.getItem('episode.contrast');
        if (contrast === 'high') document.documentElement.dataset.contrast = 'high';
        var size = localStorage.getItem('episode.textSize');
        if (size) document.documentElement.style.fontSize = size + 'px';
      } catch (_) {}
    })();
  </script>
</svelte:head>

{@render children()}
