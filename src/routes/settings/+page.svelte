<script lang="ts">
  import type { PageProps } from './$types';
  import { invalidateAll } from '$app/navigation';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import { IS_LOCAL } from '$lib/config';
  import * as api from '$lib/api';
  import { parseTvTimeExport, TvTimeImportError } from '$lib/data/tvtime-import';

  let { data }: PageProps = $props();

  let avatarValue = $state<string>('');
  let nameValue = $state<string>('');
  $effect(() => {
    avatarValue = data.profile.avatar ?? '';
    nameValue = data.profile.name ?? '';
  });
  let nameStatus = $state<'' | 'saved' | 'error'>('');
  let avatarStatus = $state<'' | 'saved' | 'error'>('');
  let avatarError = $state<string | null>(null);
  let tmdbKey = $state('');
  let tmdbStatus = $state<'' | 'saved' | 'error'>('');
  let tmdbError = $state<string | null>(null);
  let omdbKey = $state('');
  let omdbStatus = $state<'' | 'saved' | 'error'>('');
  let omdbError = $state<string | null>(null);
  let importStatus = $state<'' | 'success' | 'error'>('');
  let importMessage = $state<string | null>(null);

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

  async function saveName(event: SubmitEvent) {
    event.preventDefault();
    try {
      await api.updateProfileName(nameValue.trim());
      nameStatus = 'saved';
      await invalidateAll();
    } catch {
      nameStatus = 'error';
    }
  }

  async function saveAvatar(event: SubmitEvent) {
    event.preventDefault();
    avatarError = null;
    try {
      await api.updateAvatar(avatarValue);
      avatarStatus = 'saved';
      await invalidateAll();
    } catch (err) {
      avatarStatus = 'error';
      avatarError = err instanceof Error ? err.message : 'Erreur';
    }
  }

  async function saveTmdb(event: SubmitEvent) {
    event.preventDefault();
    tmdbError = null;
    try {
      await api.updateTmdbKey(tmdbKey.trim());
      tmdbStatus = 'saved';
      tmdbKey = '';
      await invalidateAll();
    } catch (err) {
      tmdbStatus = 'error';
      tmdbError = err instanceof Error ? err.message : 'Validation TMDB échouée';
    }
  }

  async function saveOmdb(event: SubmitEvent) {
    event.preventDefault();
    omdbError = null;
    try {
      await api.updateOmdbKey(omdbKey.trim());
      omdbStatus = 'saved';
      omdbKey = '';
      await invalidateAll();
    } catch (err) {
      omdbStatus = 'error';
      omdbError = err instanceof Error ? err.message : 'Validation OMDb échouée';
    }
  }

  /**
   * Import flow:
   *  - server target: POST the file as multipart to /api/import/tvtime
   *    (only counts entries for now — synchronization with TMDB is a separate
   *    background job, kept out of scope of this surface).
   *  - local target: read the file in the browser, parse it client-side, and
   *    expose the count back to the user.
   */
  async function importTvTime(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) {
      importStatus = 'error';
      importMessage = 'Fichier requis';
      return;
    }
    try {
      if (IS_LOCAL) {
        const text = await file.text();
        const entries = parseTvTimeExport(text);
        importStatus = 'success';
        importMessage = `${entries.length} entrées détectées.`;
      } else {
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/import/tvtime', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(await res.text().catch(() => 'Erreur'));
        const body = (await res.json()) as { count: number };
        importStatus = 'success';
        importMessage = `${body.count} entrées détectées.`;
      }
    } catch (err) {
      importStatus = 'error';
      importMessage =
        err instanceof TvTimeImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erreur';
    }
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
    <form onsubmit={saveName}>
      <div class="field">
        <label class="field__label" for="name">Nom</label>
        <input
          class="field__input"
          type="text"
          name="name"
          id="name"
          bind:value={nameValue}
          required
        />
      </div>
      <button class="btn btn--secondary" type="submit">Enregistrer</button>
      {#if nameStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)">Enregistré ✓</span>
      {/if}
    </form>

    <form onsubmit={saveAvatar} style="margin-top: var(--s-5)">
      <span class="field__label" style="display: block; margin-bottom: var(--s-3)"
        >Photo de profil</span
      >
      <AvatarPicker
        initial={initialOf(data.profile.name)}
        current={data.profile.avatar}
        onChange={(d) => (avatarValue = d)}
      />
      {#if avatarValue !== (data.profile.avatar ?? '')}
        <button class="btn btn--accent" type="submit" style="margin-top: var(--s-3)"
          >Enregistrer</button
        >
      {/if}
      {#if avatarStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)">Photo mise à jour ✓</span>
      {/if}
      {#if avatarError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
          {avatarError}
        </p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">Données</div>
    <form onsubmit={importTvTime}>
      <div class="settings-row">
        <div>
          <div class="settings-row__label">Importer depuis TV Time</div>
          <small class="settings-row__help">Fichier JSON d'export (tracking.json)</small>
        </div>
        <input type="file" name="file" accept=".json,application/json" required />
      </div>
      <button class="btn btn--accent btn--block" type="submit" style="margin-top: var(--s-3)"
        >Importer</button
      >
      {#if importStatus === 'success' && importMessage}
        <p class="field__help" style="margin-top: var(--s-2)">
          {importMessage} La synchronisation avec TMDB suivra.
        </p>
      {/if}
      {#if importStatus === 'error' && importMessage}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
          {importMessage}
        </p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">API TMDB</div>
    <form onsubmit={saveTmdb}>
      <div class="field">
        <label class="field__label" for="tmdb">Clé API TMDB</label>
        <input
          class="field__input"
          type="password"
          name="apiKey"
          id="tmdb"
          placeholder={data.tmdb.hasKey ? '••••••••••••••••' : 'Coller votre clé TMDB v3'}
          autocomplete="off"
          bind:value={tmdbKey}
        />
        <span class="field__help">
          Obtenez une clé gratuite sur
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener"
            >themoviedb.org</a
          >
        </span>
      </div>
      <button class="btn btn--secondary" type="submit">Valider et enregistrer</button>
      {#if tmdbStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)">Clé validée ✓</span>
      {/if}
      {#if tmdbError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">{tmdbError}</p>
      {/if}
    </form>

    <form onsubmit={saveOmdb} style="margin-top: var(--s-5)">
      <div class="field">
        <label class="field__label" for="omdb">Clé API OMDb (optionnelle)</label>
        <input
          class="field__input"
          type="password"
          name="omdbApiKey"
          id="omdb"
          placeholder={data.omdb.hasKey ? '••••••••••••' : 'Coller votre clé OMDb'}
          autocomplete="off"
          bind:value={omdbKey}
        />
        <span class="field__help">
          Active les notes Rotten Tomatoes et IMDb sur les fiches séries. Clé gratuite (1000
          appels/jour) sur
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener"
            >omdbapi.com</a
          >.
        </span>
      </div>
      <button class="btn btn--secondary" type="submit">Valider et enregistrer</button>
      {#if omdbStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)">Clé validée ✓</span>
      {/if}
      {#if omdbError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">{omdbError}</p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">Apparence</div>
    <div class="field">
      <span class="field__label">Thème</span>
      <div class="theme-picker" role="group" aria-label="Choix du thème">
        <button
          class="theme-picker__opt"
          aria-pressed={theme === 'auto'}
          onclick={() => setTheme('auto')}
          type="button">Auto</button
        >
        <button
          class="theme-picker__opt"
          aria-pressed={theme === 'light'}
          onclick={() => setTheme('light')}
          type="button">Clair</button
        >
        <button
          class="theme-picker__opt"
          aria-pressed={theme === 'dark'}
          onclick={() => setTheme('dark')}
          type="button">Sombre</button
        >
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
        <button class="iconbtn" onclick={() => adjustTextSize(-1)} aria-label="Réduire la taille"
          >A−</button
        >
        <button class="iconbtn" onclick={() => adjustTextSize(1)} aria-label="Augmenter la taille"
          >A+</button
        >
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Réduire les animations</div>
        <small class="settings-row__help">Transitions instantanées</small>
      </div>
      <button
        class="toggle"
        role="switch"
        aria-checked={reduceMotion}
        onclick={toggleMotion}
        aria-label="Réduire les animations"
      ></button>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Contraste élevé</div>
        <small class="settings-row__help">Bordures plus marquées</small>
      </div>
      <button
        class="toggle"
        role="switch"
        aria-checked={highContrast}
        onclick={toggleContrast}
        aria-label="Contraste élevé"
      ></button>
    </div>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">À propos</div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Episode</div>
        <small class="settings-row__help">v0.1.0 — open-source · MIT</small>
      </div>
      <a class="btn btn--secondary" href="https://github.com" target="_blank" rel="noopener"
        >GitHub</a
      >
    </div>
  </section>

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
