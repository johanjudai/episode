<script lang="ts">
  import type { PageProps } from './$types';
  import { invalidateAll } from '$app/navigation';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import * as api from '$lib/api';
  import { BackupImportError } from '$lib/data/backup';
  import ImportProgress from '$lib/components/ImportProgress.svelte';
  import { t, locale, type Locale } from '$lib/i18n';
  import { applyPalette, readStoredPalette, type PaletteChoice } from '$lib/utils/palette';
  import { importErrorKey } from '$lib/utils/import-progress';

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
  let importStatus = $state<'' | 'running' | 'success' | 'error'>('');
  let importMessage = $state<string | null>(null);
  let importPassword = $state('');
  let importProgress = $state<api.TvTimeImportProgress | null>(null);
  let importSummary = $state<api.TvTimeImportSummary | null>(null);
  let importOverlayOpen = $state(false);

  let backupExporting = $state(false);
  let backupExportError = $state<string | null>(null);
  let backupIncludeSecrets = $state(false);
  let backupImportMode = $state<'merge' | 'replace'>('merge');
  let backupStatus = $state<'' | 'success' | 'error'>('');
  let backupMessage = $state<string | null>(null);
  let backupConfirmFile = $state<File | null>(null);

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

  let localeResyncing = $state(false);

  async function chooseLocale(value: Locale) {
    if ($locale === value) return;
    locale.set(value);
    try {
      await api.updateLocale(value);
      /* The TMDB-cached strings (series names, season titles, episode
       * titles, overviews) were stored in the previous language. Kick
       * off a full re-sync of every followed series in the new locale
       * before invalidating, so the lists don't render half-French
       * half-English. The spinner indicator below the picker tells
       * the user the catalogue is updating. */
      localeResyncing = true;
      try {
        await api.resyncAllForLocale();
      } catch {
        /* Per-series failures inside the helper are already swallowed.
         * A top-level throw here would be a network/auth issue — fall
         * through to invalidateAll so the locale flip still applies
         * to UI strings even if TMDB couldn't be reached. */
      }
      await invalidateAll();
    } catch {
      /* non-fatal, persistence will retry next time */
    } finally {
      localeResyncing = false;
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
    if (!importPassword) {
      importStatus = 'error';
      importMessage = $t('settings.importPasswordRequired');
      return;
    }
    importStatus = 'running';
    importMessage = null;
    importProgress = null;
    importSummary = null;
    importOverlayOpen = true;
    try {
      const summary = await api.importTvTime(file, importPassword, (p) => {
        importProgress = p;
      });
      importStatus = 'success';
      importSummary = summary;
      importPassword = '';
      await invalidateAll();
    } catch (err) {
      importStatus = 'error';
      importMessage =
        err instanceof api.ImportError
          ? $t(importErrorKey(err.code))
          : err instanceof Error
            ? err.message
            : $t('common.error');
      importOverlayOpen = false;
    } finally {
      importProgress = null;
    }
  }

  function closeImportOverlay() {
    importOverlayOpen = false;
  }

  async function doBackupExport() {
    backupExporting = true;
    backupExportError = null;
    try {
      const backup = await api.exportLocalData({ includeSecrets: backupIncludeSecrets });
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `episode-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      /* Defer revocation — Safari (and older WebKit-based browsers used
       * by Capacitor) can cancel the download if the blob URL is
       * revoked synchronously after click(). A setTimeout punt to the
       * next tick is enough. */
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      backupExportError = err instanceof Error ? err.message : $t('common.error');
    } finally {
      backupExporting = false;
    }
  }

  async function applyBackupImport(file: File) {
    backupStatus = '';
    backupMessage = null;
    try {
      const result = await api.importLocalData(file, {
        mode: backupImportMode,
        includeSecrets: backupIncludeSecrets
      });
      backupStatus = 'success';
      backupMessage = $t('settings.backupResult', {
        series: result.counts.series,
        watched: result.counts.watched,
        settings: result.counts.settings
      });
      await invalidateAll();
    } catch (err) {
      backupStatus = 'error';
      backupMessage =
        err instanceof BackupImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : $t('settings.backupBadFile');
    }
  }

  async function onBackupImport(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) {
      backupStatus = 'error';
      backupMessage = $t('settings.fileRequired');
      return;
    }
    if (backupImportMode === 'replace') {
      /* Surface a confirmation modal-equivalent before destroying data.
       * The user already opted in by picking the radio, but the act of
       * uploading the file is the point of no return — make them
       * acknowledge once more. */
      backupConfirmFile = file;
      return;
    }
    await applyBackupImport(file);
  }

  async function confirmReplaceImport() {
    if (!backupConfirmFile) return;
    const file = backupConfirmFile;
    backupConfirmFile = null;
    await applyBackupImport(file);
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

  <!-- 1. THÈME — palette, clair/sombre, taille texte, accessibilité visuelle -->
  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.palette')}</div>
    <div class="palette-picker" role="group" aria-label={$t('settings.palettePickerAria')}>
      <button
        class="palette-card palette-card--bauhaus"
        aria-pressed={palette === 'bauhaus'}
        onclick={() => setPalette('bauhaus')}
        type="button"
      >
        <span class="palette-card__name">{$t('settings.paletteBauhaus')}</span>
        <span class="palette-card__sub">{$t('settings.paletteBauhausHint')}</span>
        <span class="palette-card__glyph palette-card__glyph--bauhaus" aria-hidden="true"></span>
      </button>
      <button
        class="palette-card palette-card--ecobrutalism"
        aria-pressed={palette === 'ecobrutalism'}
        onclick={() => setPalette('ecobrutalism')}
        type="button"
      >
        <span class="palette-card__name">{$t('settings.paletteEco')}</span>
        <span class="palette-card__sub">{$t('settings.paletteEcoHint')}</span>
        <span class="palette-card__glyph palette-card__glyph--ecobrutalism" aria-hidden="true"
          >01</span
        >
      </button>
      <button
        class="palette-card palette-card--artnouveau"
        aria-pressed={palette === 'artnouveau'}
        onclick={() => setPalette('artnouveau')}
        type="button"
      >
        <span class="palette-card__name">{$t('settings.paletteArtNouveau')}</span>
        <span class="palette-card__sub">{$t('settings.paletteArtNouveauHint')}</span>
        <span class="palette-card__glyph palette-card__glyph--artnouveau" aria-hidden="true"></span>
      </button>
    </div>

    <div class="field" style="margin-top: var(--s-5)">
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

  <!-- 2. PROFIL — nom, photo, langue -->
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

    <div class="field" style="margin-top: var(--s-5)">
      <span class="field__label">{$t('settings.language')}</span>
      <div class="theme-picker" role="group" aria-label={$t('locale.title')}>
        <button
          class="theme-picker__opt"
          aria-pressed={$locale === 'fr'}
          onclick={() => chooseLocale('fr')}
          type="button"
          disabled={localeResyncing}>{$t('locale.fr')}</button
        >
        <button
          class="theme-picker__opt"
          aria-pressed={$locale === 'en'}
          onclick={() => chooseLocale('en')}
          type="button"
          disabled={localeResyncing}>{$t('locale.en')}</button
        >
      </div>
      {#if localeResyncing}
        <span class="field__help" aria-live="polite" style="margin-top: var(--s-2); display: block"
          >{$t('settings.localeResyncing')}</span
        >
      {/if}
    </div>
  </section>

  <!-- 3. IMPORT/EXPORT — TV Time + sauvegarde locale JSON -->
  <section class="settings-group">
    <div class="settings-group__title">{$t('settings.data')}</div>

    <form onsubmit={importTvTime}>
      <div class="field">
        <label class="field__label" for="tvtime-file">{$t('settings.importTitle')}</label>
        <input
          class="field__input"
          type="file"
          name="file"
          id="tvtime-file"
          accept=".zip,application/zip"
          required
          disabled={importStatus === 'running'}
        />
        <span class="field__help">{$t('settings.importHelp')}</span>
      </div>
      <div class="field">
        <label class="field__label" for="tvtime-password"
          >{$t('settings.importPasswordLabel')}</label
        >
        <input
          class="field__input"
          type="password"
          name="password"
          id="tvtime-password"
          autocomplete="off"
          bind:value={importPassword}
          disabled={importStatus === 'running'}
        />
        <span class="field__help">{$t('settings.importPasswordHelp')}</span>
      </div>
      <button
        class="btn btn--accent btn--block"
        type="submit"
        style="margin-top: var(--s-3)"
        disabled={importStatus === 'running'}
      >
        {importStatus === 'running' ? $t('settings.importRunning') : $t('settings.importBtn')}
      </button>
      {#if importStatus === 'success' && importSummary && !importOverlayOpen}
        <div class="field__help" style="margin-top: var(--s-3)">
          <p>
            <strong>{$t('settings.importDone')}</strong>
          </p>
          <ul style="margin-top: var(--s-2); padding-left: var(--s-4)">
            <li>
              {$t('settings.importStatsSeries', {
                synced: importSummary.seriesSynced,
                matched: importSummary.seriesMatched
              })}
            </li>
            <li>
              {$t('settings.importStatsWatches', {
                applied: importSummary.watchesApplied,
                skipped: importSummary.watchesSkipped
              })}
            </li>
            {#if importSummary.syncFailed.length > 0}
              <li style="color: var(--bw-red)">
                {$t('settings.importStatsSyncFailed', { count: importSummary.syncFailed.length })}
              </li>
            {/if}
            {#if importSummary.unresolved.length > 0}
              <li style="color: var(--bw-red)">
                {$t('settings.importStatsUnresolved', { count: importSummary.unresolved.length })}
              </li>
            {/if}
          </ul>
          {#if importSummary.unresolved.length > 0}
            <details style="margin-top: var(--s-2)">
              <summary>{$t('settings.importUnresolvedShow')}</summary>
              <ul style="margin-top: var(--s-2); padding-left: var(--s-4)">
                {#each importSummary.unresolved as u (u.tvdbId)}
                  <li>{u.name} <small>(TVDB #{u.tvdbId})</small></li>
                {/each}
              </ul>
            </details>
          {/if}
        </div>
      {/if}
      {#if importStatus === 'error' && importMessage}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
          {importMessage}
        </p>
      {/if}
    </form>

    <div style="margin-top: var(--s-5); border-top: 1px solid var(--bw-border); padding-top: var(--s-4)">
      <div class="settings-row__label" style="margin-bottom: var(--s-2)">{$t('settings.backupTitle')}</div>

      <div class="settings-row">
        <div>
          <div class="settings-row__label">{$t('settings.backupExport')}</div>
          <small class="settings-row__help">{$t('settings.backupExportHelp')}</small>
        </div>
      </div>
      <label class="settings-row" style="cursor: pointer">
        <div>
          <div class="settings-row__label">{$t('settings.backupIncludeSecrets')}</div>
          <small class="settings-row__help">{$t('settings.backupIncludeSecretsHelp')}</small>
        </div>
        <input type="checkbox" bind:checked={backupIncludeSecrets} />
      </label>
      <button
        class="btn btn--secondary btn--block"
        type="button"
        onclick={doBackupExport}
        disabled={backupExporting}
        style="margin-top: var(--s-3)"
      >
        {backupExporting ? $t('settings.backupExporting') : $t('settings.backupExport')}
      </button>
      {#if backupExportError}
        <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
          {backupExportError}
        </p>
      {/if}

      <form onsubmit={onBackupImport} style="margin-top: var(--s-5)">
        <div class="settings-row">
          <div>
            <div class="settings-row__label">{$t('settings.backupImport')}</div>
            <small class="settings-row__help">{$t('settings.backupImportHelp')}</small>
          </div>
          <input type="file" name="file" accept=".json,application/json" required />
        </div>
        <div class="field" style="margin-top: var(--s-3)">
          <label class="settings-row" style="cursor: pointer">
            <div>
              <div class="settings-row__label">{$t('settings.backupModeMerge')}</div>
              <small class="settings-row__help">{$t('settings.backupModeMergeHelp')}</small>
            </div>
            <input type="radio" name="backupMode" value="merge" bind:group={backupImportMode} />
          </label>
          <label class="settings-row" style="cursor: pointer">
            <div>
              <div class="settings-row__label">{$t('settings.backupModeReplace')}</div>
              <small class="settings-row__help">{$t('settings.backupModeReplaceHelp')}</small>
            </div>
            <input type="radio" name="backupMode" value="replace" bind:group={backupImportMode} />
          </label>
        </div>
        <button class="btn btn--accent btn--block" type="submit" style="margin-top: var(--s-3)"
          >{$t('settings.backupImport')}</button
        >
        {#if backupStatus === 'success' && backupMessage}
          <p class="field__help" style="margin-top: var(--s-2)">{backupMessage}</p>
        {/if}
        {#if backupStatus === 'error' && backupMessage}
          <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
            {backupMessage}
          </p>
        {/if}
      </form>
    </div>
  </section>

  {#if !data.tmdb.fromEnv || !data.omdb.fromEnv}
    <!-- Clés API — masquées entièrement si les deux clés viennent du .env du serveur,
         sinon affichées sous import/export et avant À propos. -->
    <section class="settings-group">
      <div class="settings-group__title">{$t('settings.tmdbApi')}</div>
      {#if !data.tmdb.fromEnv}
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
            <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
              {tmdbError}
            </p>
          {/if}
        </form>
      {/if}

      {#if !data.omdb.fromEnv}
        <form onsubmit={saveOmdb} style={!data.tmdb.fromEnv ? 'margin-top: var(--s-5)' : ''}>
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
            <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
              {omdbError}
            </p>
          {/if}
        </form>
      {/if}
    </section>
  {/if}

  <!-- 4. À PROPOS -->
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

  {#if backupConfirmFile}
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-replace-title"
    >
      <div class="modal">
        <div class="modal__kicker">{$t('common.confirm')}</div>
        <h2 class="modal__title" id="backup-replace-title">
          {$t('settings.backupReplaceConfirmTitle')}
        </h2>
        <p class="modal__body">{$t('settings.backupReplaceConfirmBody')}</p>
        <div class="modal__actions">
          <button
            class="btn btn--secondary"
            type="button"
            onclick={() => (backupConfirmFile = null)}
          >
            {$t('common.cancel')}
          </button>
          <button class="btn btn--accent" type="button" onclick={confirmReplaceImport}>
            {$t('settings.backupReplaceConfirmAction')}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <div class="spacer"></div>
  <BottomNav current="profile" />
</main>

{#if importOverlayOpen}
  <ImportProgress progress={importProgress} summary={importSummary} onDone={closeImportOverlay} />
{/if}
