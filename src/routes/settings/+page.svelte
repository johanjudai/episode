<script lang="ts">
  import type { PageProps } from './$types';
  import { invalidateAll } from '$app/navigation';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import { IS_LOCAL } from '$lib/config';
  import * as api from '$lib/api';
  import { parseTvTimeExport, TvTimeImportError } from '$lib/data/tvtime-import';
  import { t, locale, type Locale } from '$lib/i18n';
  import { applyPalette, readStoredPalette, type PaletteChoice } from '$lib/utils/palette';

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
  let palette = $state<PaletteChoice>('bauhaus');
  let reduceMotion = $state(false);
  let highContrast = $state(false);
  let textSize = $state(16);

  function loadPrefs() {
    if (typeof localStorage === 'undefined') return;
    theme = (localStorage.getItem('episode.theme') as 'auto' | 'light' | 'dark') ?? 'auto';
    palette = readStoredPalette();
    reduceMotion = localStorage.getItem('episode.motion') === 'reduced';
    highContrast = localStorage.getItem('episode.contrast') === 'high';
    textSize = Number(localStorage.getItem('episode.textSize') ?? '16');
  }

  function setPalette(value: PaletteChoice) {
    palette = value;
    localStorage.setItem('episode.palette', value);
    applyPalette(value);
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

  async function chooseLocale(value: Locale) {
    if ($locale === value) return;
    locale.set(value);
    try {
      await api.updateLocale(value);
      await invalidateAll();
    } catch {
      /* non-fatal, persistence will retry next time */
    }
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
      avatarError = err instanceof Error ? err.message : $t('common.error');
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
      tmdbError = err instanceof Error ? err.message : $t('settings.tmdbFailed');
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
      omdbError = err instanceof Error ? err.message : $t('settings.omdbFailed');
    }
  }

  async function importTvTime(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) {
      importStatus = 'error';
      importMessage = $t('settings.fileRequired');
      return;
    }
    try {
      if (IS_LOCAL) {
        const text = await file.text();
        const entries = parseTvTimeExport(text);
        importStatus = 'success';
        importMessage = $t('settings.importResult', { count: entries.length });
      } else {
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/import/tvtime', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(await res.text().catch(() => $t('common.error')));
        const body = (await res.json()) as { count: number };
        importStatus = 'success';
        importMessage = $t('settings.importResult', { count: body.count });
      }
    } catch (err) {
      importStatus = 'error';
      importMessage =
        err instanceof TvTimeImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : $t('common.error');
    }
  }

  $effect(loadPrefs);
</script>

<svelte:head><title>{$t('settings.title')}</title></svelte:head>

<main class="app">
  <header class="topbar">
    <a href="/profile" class="iconbtn" aria-label={$t('common.back')}>←</a>
    <h1 class="topbar__title">{$t('settings.header')}</h1>
    <div style="width: 36px"></div>
  </header>

  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.profile')}</div>
    <form onsubmit={saveName}>
      <div class="field">
        <label class="field__label" for="name">{$t('settings.name')}</label>
        <input
          class="field__input"
          type="text"
          name="name"
          id="name"
          bind:value={nameValue}
          required
        />
      </div>
      <button class="btn btn--secondary" type="submit">{$t('common.save')}</button>
      {#if nameStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)">{$t('common.saved')}</span>
      {/if}
    </form>

    <form onsubmit={saveAvatar} style="margin-top: var(--s-5)">
      <span class="field__label" style="display: block; margin-bottom: var(--s-3)"
        >{$t('settings.photo')}</span
      >
      <AvatarPicker
        initial={initialOf(data.profile.name)}
        current={data.profile.avatar}
        onChange={(d) => (avatarValue = d)}
      />
      {#if avatarValue !== (data.profile.avatar ?? '')}
        <button class="btn btn--accent" type="submit" style="margin-top: var(--s-3)"
          >{$t('common.save')}</button
        >
      {/if}
      {#if avatarStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)">{$t('settings.photoSaved')}</span>
      {/if}
      {#if avatarError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
          {avatarError}
        </p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.data')}</div>
    <form onsubmit={importTvTime}>
      <div class="settings-row">
        <div>
          <div class="settings-row__label">{$t('settings.importTitle')}</div>
          <small class="settings-row__help">{$t('settings.importHelp')}</small>
        </div>
        <input type="file" name="file" accept=".json,application/json" required />
      </div>
      <button class="btn btn--accent btn--block" type="submit" style="margin-top: var(--s-3)"
        >{$t('settings.importBtn')}</button
      >
      {#if importStatus === 'success' && importMessage}
        <p class="field__help" style="margin-top: var(--s-2)">{importMessage}</p>
      {/if}
      {#if importStatus === 'error' && importMessage}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
          {importMessage}
        </p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.tmdbApi')}</div>
    <form onsubmit={saveTmdb}>
      <div class="field">
        <label class="field__label" for="tmdb">{$t('settings.tmdbLabel')}</label>
        <input
          class="field__input"
          type="password"
          name="apiKey"
          id="tmdb"
          placeholder={data.tmdb.hasKey
            ? $t('settings.tmdbPlaceholderSet')
            : $t('settings.tmdbPlaceholderEmpty')}
          autocomplete="off"
          bind:value={tmdbKey}
        />
        <span class="field__help">
          {$t('settings.tmdbGetKey')}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener"
            >themoviedb.org</a
          >
        </span>
      </div>
      <button class="btn btn--secondary" type="submit">{$t('settings.tmdbValidate')}</button>
      {#if tmdbStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)"
          >{$t('settings.tmdbValidated')}</span
        >
      {/if}
      {#if tmdbError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">{tmdbError}</p>
      {/if}
    </form>

    <form onsubmit={saveOmdb} style="margin-top: var(--s-5)">
      <div class="field">
        <label class="field__label" for="omdb">{$t('settings.omdbLabel')}</label>
        <input
          class="field__input"
          type="password"
          name="omdbApiKey"
          id="omdb"
          placeholder={data.omdb.hasKey
            ? $t('settings.omdbPlaceholderSet')
            : $t('settings.omdbPlaceholderEmpty')}
          autocomplete="off"
          bind:value={omdbKey}
        />
        <span class="field__help">
          {$t('settings.omdbHelp')}
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener"
            >omdbapi.com</a
          >.
        </span>
      </div>
      <button class="btn btn--secondary" type="submit">{$t('settings.tmdbValidate')}</button>
      {#if omdbStatus === 'saved'}
        <span class="field__help" style="margin-left: var(--s-3)"
          >{$t('settings.omdbValidated')}</span
        >
      {/if}
      {#if omdbError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">{omdbError}</p>
      {/if}
    </form>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.appearance')}</div>
    <div class="field">
      <span class="field__label">{$t('settings.language')}</span>
      <div class="theme-picker" role="group" aria-label={$t('locale.title')}>
        <button
          class="theme-picker__opt"
          aria-pressed={$locale === 'fr'}
          onclick={() => chooseLocale('fr')}
          type="button">{$t('locale.fr')}</button
        >
        <button
          class="theme-picker__opt"
          aria-pressed={$locale === 'en'}
          onclick={() => chooseLocale('en')}
          type="button">{$t('locale.en')}</button
        >
      </div>
    </div>
    <div class="field">
      <span class="field__label">{$t('settings.theme')}</span>
      <div class="theme-picker" role="group" aria-label={$t('settings.themePickerAria')}>
        <button
          class="theme-picker__opt"
          aria-pressed={theme === 'auto'}
          onclick={() => setTheme('auto')}
          type="button">{$t('settings.themeAuto')}</button
        >
        <button
          class="theme-picker__opt"
          aria-pressed={theme === 'light'}
          onclick={() => setTheme('light')}
          type="button">{$t('settings.themeLight')}</button
        >
        <button
          class="theme-picker__opt"
          aria-pressed={theme === 'dark'}
          onclick={() => setTheme('dark')}
          type="button">{$t('settings.themeDark')}</button
        >
      </div>
    </div>
    <div class="field">
      <span class="field__label">{$t('settings.palette')}</span>
      <div class="palette-picker" role="group" aria-label={$t('settings.palettePickerAria')}>
        <button
          class="palette-card palette-card--bauhaus"
          aria-pressed={palette === 'bauhaus'}
          onclick={() => setPalette('bauhaus')}
          type="button"
        >
          <span class="palette-card__swatch" aria-hidden="true">
            <span class="palette-card__chip palette-card__chip--bh-1"></span>
            <span class="palette-card__chip palette-card__chip--bh-2"></span>
            <span class="palette-card__chip palette-card__chip--bh-3"></span>
          </span>
          <span class="palette-card__label">{$t('settings.paletteBauhaus')}</span>
          <span class="palette-card__hint">{$t('settings.paletteBauhausHint')}</span>
        </button>
        <button
          class="palette-card palette-card--ecobrutalism"
          aria-pressed={palette === 'ecobrutalism'}
          onclick={() => setPalette('ecobrutalism')}
          type="button"
        >
          <span class="palette-card__swatch" aria-hidden="true">
            <span class="palette-card__chip palette-card__chip--eb-1"></span>
            <span class="palette-card__chip palette-card__chip--eb-2"></span>
            <span class="palette-card__chip palette-card__chip--eb-3"></span>
          </span>
          <span class="palette-card__label">{$t('settings.paletteEco')}</span>
          <span class="palette-card__hint">{$t('settings.paletteEcoHint')}</span>
        </button>
      </div>
    </div>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.a11y')}</div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">{$t('settings.textSize')}</div>
        <small class="settings-row__help">{textSize}px</small>
      </div>
      <div class="row">
        <button
          class="iconbtn"
          onclick={() => adjustTextSize(-1)}
          aria-label={$t('settings.textSizeSmaller')}>A−</button
        >
        <button
          class="iconbtn"
          onclick={() => adjustTextSize(1)}
          aria-label={$t('settings.textSizeBigger')}>A+</button
        >
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">{$t('settings.reduceMotion')}</div>
        <small class="settings-row__help">{$t('settings.reduceMotionHelp')}</small>
      </div>
      <button
        class="toggle"
        role="switch"
        aria-checked={reduceMotion}
        onclick={toggleMotion}
        aria-label={$t('settings.reduceMotionAria')}
      ></button>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">{$t('settings.highContrast')}</div>
        <small class="settings-row__help">{$t('settings.highContrastHelp')}</small>
      </div>
      <button
        class="toggle"
        role="switch"
        aria-checked={highContrast}
        onclick={toggleContrast}
        aria-label={$t('settings.highContrastAria')}
      ></button>
    </div>
  </section>

  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.about')}</div>
    <div class="settings-row">
      <div>
        <div class="settings-row__label">Episode</div>
        <small class="settings-row__help">{$t('settings.aboutHelp')}</small>
      </div>
      <a
        class="btn btn--secondary"
        href="https://github.com/johanjudai/episode"
        target="_blank"
        rel="noopener">{$t('settings.github')}</a
      >
    </div>
  </section>

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>
