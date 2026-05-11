<script lang="ts">
  import '../app.css';
  interface Props {
    children: import('svelte').Snippet;
  }
  let { children }: Props = $props();
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
