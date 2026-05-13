<script lang="ts">
  import { t } from '$lib/i18n';
  interface Props {
    current: 'home' | 'search' | 'profile';
  }
  let { current }: Props = $props();
</script>

<nav class="bottom-nav" aria-label={$t('nav.home')}>
  <a href="/" aria-current={current === 'home' ? 'page' : undefined}>
    <span class="bottom-nav__shape bottom-nav__shape--circle" aria-hidden="true"></span>
    <span class="bottom-nav__label">{$t('nav.home')}</span>
  </a>
  <a href="/search" aria-current={current === 'search' ? 'page' : undefined}>
    <span class="bottom-nav__shape bottom-nav__shape--square" aria-hidden="true"></span>
    <span class="bottom-nav__label">{$t('nav.search')}</span>
  </a>
  <a href="/profile" aria-current={current === 'profile' ? 'page' : undefined}>
    <span class="bottom-nav__shape bottom-nav__shape--triangle" aria-hidden="true"></span>
    <span class="bottom-nav__label">{$t('nav.profile')}</span>
  </a>
</nav>
