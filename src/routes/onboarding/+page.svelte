<script lang="ts">
  import type { PageProps } from './$types';
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import Mark from '$lib/components/Mark.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import * as api from '$lib/api';
  import ImportProgress from '$lib/components/ImportProgress.svelte';
  import { t, locale, type Locale } from '$lib/i18n';
  import { applyPalette, readStoredPalette, type PaletteChoice } from '$lib/utils/palette';
  import { importErrorKey } from '$lib/utils/import-progress';
  import OrnateFrame from '$lib/components/OrnateFrame.svelte';

  let { data }: PageProps = $props();

  let name = $state('');
  let avatar = $state('');
  let palette = $state<PaletteChoice>('bauhaus');
  let submitting = $state(false);
  let errorMsg = $state<string | null>(null);
  const initial = $derived(name ? initialOf(name) : '?');

  /* Import-related state. The TMDB key field is shown only when the
   * key isn't already managed (env or saved in settings). In local
   * target there's never an env, so the user always sees it on
   * first launch. */
  let tmdbKey = $state('');
  let importFile = $state<File | null>(null);
  let importPassword = $state('');
  let importProgress = $state<api.TvTimeImportProgress | null>(null);
  let importSummary = $state<api.TvTimeImportSummary | null>(null);
  let importOverlayOpen = $state(false);
  /* Local state for the <details> open flag — using `open={expr}` would
   * fight the user's manual toggle because every reactive update would
   * write the attribute back. With bind:open + a local $state the
   * user's interaction is preserved. `untrack` tells Svelte we only
   * want the initial value (no later sync from the prop). */
  let importDetailsOpen = $state(untrack(() => !data.tmdb.hasKey));
  const needsTmdbKey = $derived(!data.tmdb.hasKey);
  const importReady = $derived(
    !!importFile && !!importPassword && (!needsTmdbKey || !!tmdbKey.trim())
  );

  $effect(() => {
    palette = readStoredPalette();
  });

  function choosePalette(value: PaletteChoice) {
    palette = value;
    if (typeof localStorage !== 'undefined') localStorage.setItem('episode.palette', value);
    applyPalette(value);
  }

  async function chooseLocale(value: Locale) {
    if ($locale === value) return;
    locale.set(value);
    /* Persist immediately so a reload picks the same language. */
    void api.updateLocale(value).catch(() => undefined);
  }

  function onFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    importFile = file;
  }

  async function finalize(withImport: boolean) {
    if (submitting) return;
    if (!name.trim()) {
      errorMsg = $t('onboarding.nameRequired');
      return;
    }
    submitting = true;
    errorMsg = null;
    importProgress = null;
    importSummary = null;
    try {
      /* Save TMDB key first if the user typed one — we need it for the
       * import to resolve series, and persisting before the import
       * means a later retry in Settings already has the key in place. */
      if (withImport && needsTmdbKey && tmdbKey.trim()) {
        await api.updateTmdbKey(tmdbKey.trim());
      }

      /* Persist the profile early so the user is "logged in" even if
       * the import fails halfway. They can retry from Settings → Data. */
      await api.completeOnboarding(name.trim(), avatar);

      if (withImport && importFile && importPassword) {
        importOverlayOpen = true;
        const summary = await api.importTvTime(importFile, importPassword, (p) => {
          importProgress = p;
        });
        importSummary = summary;
        /* When the overlay's CTA fires, the user lands on the home
         * page. We don't redirect immediately so they can read the
         * "all set" celebration first. */
        return;
      }

      await invalidateAll();
      await goto('/');
    } catch (err) {
      errorMsg =
        err instanceof api.ImportError
          ? $t(importErrorKey(err.code))
          : err instanceof Error
            ? err.message
            : $t('common.error');
      submitting = false;
      importOverlayOpen = false;
      importProgress = null;
    }
  }

  async function onImportComplete() {
    await invalidateAll();
    await goto('/');
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void finalize(importReady);
  }

  function skipImport(event: MouseEvent) {
    event.preventDefault();
    importFile = null;
    importPassword = '';
    void finalize(false);
  }
</script>

<svelte:head><title>{$t('onboarding.title')}</title></svelte:head>

<main class="app">
  <form class="onboarding" onsubmit={submit}>
    <div class="onboarding__lang" role="group" aria-label={$t('locale.title')}>
      <button
        type="button"
        class="onboarding__lang-opt"
        aria-pressed={$locale === 'fr'}
        onclick={() => chooseLocale('fr')}>{$t('locale.fr')}</button
      >
      <button
        type="button"
        class="onboarding__lang-opt"
        aria-pressed={$locale === 'en'}
        onclick={() => chooseLocale('en')}>{$t('locale.en')}</button
      >
    </div>

    <Mark />

    <div class="onboarding__hero" aria-hidden="true">
      <div class="shape shape--circle"></div>
      <div class="shape shape--square"></div>
      <div class="shape shape--tri"></div>
    </div>

    <OrnateFrame>
      <div class="onboarding__intro">
        <h1>{$t('onboarding.hello')}<br /><strong>{$t('onboarding.tagline')}</strong></h1>
        <p class="onboarding__lead">{$t('onboarding.lead')}</p>
      </div>
    </OrnateFrame>

    <div class="field">
      <label class="field__label" for="name">{$t('onboarding.nameLabel')}</label>
      <input
        class="field__input"
        type="text"
        name="name"
        id="name"
        placeholder={$t('onboarding.namePlaceholder')}
        required
        maxlength="80"
        autocomplete="given-name"
        bind:value={name}
        disabled={submitting}
      />
    </div>

    <div class="field">
      <span class="field__label">{$t('onboarding.avatarLabel')}</span>
      <AvatarPicker {initial} onChange={(d) => (avatar = d)} />
      <span class="field__help">{$t('onboarding.avatarHelp')}</span>
    </div>

    <div class="field">
      <span class="field__label">{$t('onboarding.paletteLabel')}</span>
      <div class="palette-picker" role="group" aria-label={$t('settings.palettePickerAria')}>
        <button
          type="button"
          class="palette-card palette-card--bauhaus"
          aria-pressed={palette === 'bauhaus'}
          onclick={() => choosePalette('bauhaus')}
        >
          <span class="palette-card__name">{$t('settings.paletteBauhaus')}</span>
          <span class="palette-card__sub">{$t('settings.paletteBauhausHint')}</span>
          <span class="palette-card__glyph palette-card__glyph--bauhaus" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          class="palette-card palette-card--ecobrutalism"
          aria-pressed={palette === 'ecobrutalism'}
          onclick={() => choosePalette('ecobrutalism')}
        >
          <span class="palette-card__name">{$t('settings.paletteEco')}</span>
          <span class="palette-card__sub">{$t('settings.paletteEcoHint')}</span>
          <span class="palette-card__glyph palette-card__glyph--ecobrutalism" aria-hidden="true"
            >01</span
          >
        </button>
        <button
          type="button"
          class="palette-card palette-card--artnouveau"
          aria-pressed={palette === 'artnouveau'}
          onclick={() => choosePalette('artnouveau')}
        >
          <span class="palette-card__name">{$t('settings.paletteArtNouveau')}</span>
          <span class="palette-card__sub">{$t('settings.paletteArtNouveauHint')}</span>
          <span class="palette-card__glyph palette-card__glyph--artnouveau" aria-hidden="true"
          ></span>
        </button>
      </div>
    </div>

    <details class="onboarding__import" bind:open={importDetailsOpen}>
      <summary>
        <span class="onboarding__import-title">{$t('onboarding.importTitle')}</span>
        <span class="onboarding__import-meta">{$t('common.optional')}</span>
      </summary>

      <div class="onboarding__import-body">
        <p class="field__help" style="margin-bottom: var(--s-3)">{$t('onboarding.importIntro')}</p>

        <ol class="onboarding__howto">
          <li>
            {$t('onboarding.importStep1Lead')}<a href="mailto:support@tvtime.com"
              ><code>support@tvtime.com</code></a
            >{$t('onboarding.importStep1Suf')}<a
              href={$t('onboarding.importStep1PrivacyUrl')}
              target="_blank"
              rel="noopener">{$t('onboarding.importStep1PrivacyLink')}</a
            >{$t('onboarding.importStep1End')}
          </li>
          <li>{$t('onboarding.importStep2')}</li>
        </ol>

        {#if needsTmdbKey}
          <div class="field" style="margin-top: var(--s-3)">
            <label class="field__label" for="onboarding-tmdb">{$t('settings.tmdbLabel')}</label>
            <input
              class="field__input"
              type="password"
              id="onboarding-tmdb"
              autocomplete="off"
              bind:value={tmdbKey}
              disabled={submitting}
            />
            <span class="field__help">
              {$t('settings.tmdbGetKey')}
              <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener"
                >themoviedb.org</a
              >
            </span>
          </div>
        {/if}

        <div class="field">
          <label class="field__label" for="onboarding-file">{$t('settings.importTitle')}</label>
          <input
            class="field__input"
            type="file"
            id="onboarding-file"
            accept=".zip,application/zip"
            onchange={onFileChange}
            disabled={submitting}
          />
          <span class="field__help">{$t('settings.importHelp')}</span>
        </div>

        <div class="field">
          <label class="field__label" for="onboarding-password"
            >{$t('settings.importPasswordLabel')}</label
          >
          <input
            class="field__input"
            type="password"
            id="onboarding-password"
            autocomplete="off"
            bind:value={importPassword}
            disabled={submitting}
          />
          <span class="field__help">{$t('settings.importPasswordHelp')}</span>
        </div>
      </div>
    </details>

    <div class="spacer"></div>

    {#if errorMsg}
      <p class="field__help" style="color: var(--bw-red)">{errorMsg}</p>
    {/if}

    <button type="submit" class="btn btn--accent btn--block btn--lg" disabled={submitting}>
      {submitting
        ? importReady
          ? $t('settings.importRunning')
          : $t('onboarding.submitting')
        : importReady
          ? $t('onboarding.submitWithImport')
          : $t('onboarding.submit')}
    </button>
    {#if importReady && !submitting}
      <button
        type="button"
        class="btn btn--secondary btn--block"
        style="margin-top: var(--s-2)"
        onclick={skipImport}
        disabled={submitting}>{$t('onboarding.skipImport')}</button
      >
    {/if}
  </form>
</main>

{#if importOverlayOpen}
  <ImportProgress progress={importProgress} summary={importSummary} onDone={onImportComplete} />
{/if}
