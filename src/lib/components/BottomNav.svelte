<script lang="ts">
  interface Props {
    current: 'home' | 'search' | 'profile';
  }
  let { current }: Props = $props();
</script>

<nav class="bottom-nav" aria-label="Navigation principale">
  <a href="/" aria-current={current === 'home' ? 'page' : undefined}>À voir</a>
  <a href="/search" aria-current={current === 'search' ? 'page' : undefined}>Recherche</a>
  <a href="/profile" aria-current={current === 'profile' ? 'page' : undefined}>Profil</a>
</nav>
