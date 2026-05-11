<script lang="ts">
  import type { PageProps } from './$types';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';

  let { data, form }: PageProps = $props();

  let avatarValue = $state<string>(data.profile.avatar ?? '');

  let theme = $state<'auto' | 'light' | 'dark'>('auto');
  let reduceMotion = $state(false);
  let highContrast = $state(false);
  let textSize = $state(16);

  function loadPrefs() {
    if (typeof localStorage === 'undefined') return;
    theme = (localStorage.getItem('episode.theme') as 'auto' | 'light' | 'dark') ?? 'auto';
    reduceMotion = localStorage.getItem('episode.motion') === 'reduced';
    highContrast = localStorage.getItem('episode.contrast') === 'high';
    textSize = Number(localStorage.getItem('episode.textSize') ?? '16');
  }

  function setTheme(value: 'auto' | 'light' | 'dark') {
    theme = value;
    localStorage.setItem('episode.theme', value);
    const dark =
      value === 'dark' ||
      (value === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function toggleMotion() {
    reduceMotion = !reduceMotion;
    if (reduceMotion) {
      localStorage.setItem('episode.motion', 'reduced');
      document.documentElement.dataset.motion = 'reduced';
    } else {
      localStorage.removeItem('episode.motion');
      delete document.documentElement.dataset.motion;
    }
  }

  function toggleContrast() {
    highContrast = !highContrast;
    if (highContrast) {
      localStorage.setItem('episode.contrast', 'high');
      document.documentElement.dataset.contrast = 'high';
    } else {
      localStorage.removeItem('episode.contrast');
      delete document.documentElement.dataset.contrast;
    }
  }

  function adjustTextSize(delta: number) {
    textSize = Math.max(12, Math.min(22, textSize + delta));
    localStorage.setItem('episode.textSize', String(textSize));
    document.documentElement.style.fontSize = textSize + 'px';
  }

  $effect(loadPrefs);
</script>

<svelte:head><title>Paramètres — Episode</title></svelte:head>

<main class="app">
  <header class="topbar">
    <a href="/profile" class="iconbtn" aria-label="Retour">←</a>
    <h1 class="topbar__title">Paramètres</h1>
    <div style="width: 40px"></div>
  </header>

  <section class="settings-group">
    <div class="settings-group__title">Profil</div>
    <form method="POST" action="?/updateProfile">
      <div class="field">
        <label class="field__label" for="name">Nom</label>
        <input class="field__input" type="text" name="name" id="name" value={data.profile.name} required />
      </div>
      <button class="btn btn--secondary" type="submit">Enregistrer</button>
      {#if form?.scope === 'profile' && form?.success}
        <span class="field__help" style="margin-left: var(--s-3)">Enregistré ✓</span>
      {/if}
    </form>

    <form method="POST" action="?/updateAvatar" style="margin-top: var(--s-5)">
      <span class="field__label" style="display: block; margin-bottom: var(--s-3)">Photo de profil</span>
      <AvatarPicker
        initial={initialOf(data.profile.name)}
        current={data.profile.avatar}
        onChange={(d) => (avatarValue = d)}
      />
      <input type="hidden" name="avatar" value={avatarValue} />
      {#if avatarValue !== (data.profile.avatar ?? '')}
        <button class="btn btn--accent" type="submit" style="margin-top: var(--s-3)">Enregistrer</button>
      {/if}
      {#if form?.scope === 'avatar' && form?.success}
        <span class="field__help" style="margin-left: var(--s-3)">Photo mise à jour ✓</span>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">Données</div>
    <form method="POST" action="?/importTvTime" enctype="multipart/form-data">
      <div class="settings-row">
        <div>
          <div class="settings-row__label">Importer depuis TV Time</div>
          <small class="settings-row__help">Fichier JSON d'export (tracking.json)</small>
        </div>
        <input type="file" name="file" accept=".json,application/json" required />
      </div>
      <button class="btn btn--accent btn--block" type="submit" style="margin-top: var(--s-3)">Importer</button>
      {#if form?.scope === 'import' && form?.success}
        <p class="field__help" style="margin-top: var(--s-2)">
          {form.count} entrées détectées. La synchronisation avec TMDB suivra.
        </p>
      {/if}
      {#if form?.error}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">{form.error}</p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">API TMDB</div>
    <form method="POST" action="?/updateTmdbKey">
      <div class="field">
        <label class="field__label" for="tmdb">Clé API TMDB</label>
        <input
          class="field__input"
          type="password"
          name="apiKey"
          id="tmdb"
          placeholder={data.tmdb.hasKey ? '••••••••••••••••' : 'Coller votre clé TMDB v3'}
          autocomplete="off"
        />
        <span class="field__help">
          Obtenez une clé gratuite sur
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org</a>
        </span>
      </div>
      <button class="btn btn--secondary" type="submit">Valider et enregistrer</button>
      {#if form?.scope === 'tmdb' && form?.success}
        <span class="field__help" style="margin-left: var(--s-3)">Clé validée ✓</span>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">Apparence</div>
    <div class="field">
      <span class="field__label">Thème</span>
      <div class="theme-picker" role="group" aria-label="Choix du thème">
        <button class="theme-picker__opt" aria-pressed={theme === 'auto'} onclick={() => setTheme('auto')} type="button">Auto</button>
        <button class="theme-picker__opt" aria-pressed={theme === 'light'} onclick={() => setTheme('light')} type="button">Clair</button>
        <button class="theme-picker__opt" aria-pressed={theme === 'dark'} onclick={() => setTheme('dark')} type="button">Sombre</button>
      </div>
    </div>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">Accessibilité</div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Taille du texte</div>
        <small class="settings-row__help">{textSize}px</small>
      </div>
      <div class="row">
        <button class="iconbtn" onclick={() => adjustTextSize(-1)} aria-label="Réduire la taille">A−</button>
        <button class="iconbtn" onclick={() => adjustTextSize(1)} aria-label="Augmenter la taille">A+</button>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Réduire les animations</div>
        <small class="settings-row__help">Transitions instantanées</small>
      </div>
      <button class="toggle" role="switch" aria-checked={reduceMotion} onclick={toggleMotion} aria-label="Réduire les animations"></button>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Contraste élevé</div>
        <small class="settings-row__help">Bordures plus marquées</small>
      </div>
      <button class="toggle" role="switch" aria-checked={highContrast} onclick={toggleContrast} aria-label="Contraste élevé"></button>
    </div>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">À propos</div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Episode</div>
        <small class="settings-row__help">v0.1.0 — open-source · MIT</small>
      </div>
      <a class="btn btn--secondary" href="https://github.com" target="_blank" rel="noopener">GitHub</a>
    </div>
  </section>

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
