<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import Mark from '$lib/components/Mark.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import * as api from '$lib/api';
  import { t, locale, type Locale } from '$lib/i18n';

  let name = $state('');
  let avatar = $state('');
  let importFile = $state<File | null>(null);
  let importPreview = $state<{ count: number } | null>(null);
  let importError = $state<string | null>(null);
  let submitting = $state(false);
  let errorMsg = $state<string | null>(null);
  const initial = $derived(name ? initialOf(name) : '?');

  async function chooseLocale(value: Locale) {
    if ($locale === value) return;
    locale.set(value);
    /* Persist immediately so a reload picks the same language. */
    void api.updateLocale(value).catch(() => undefined);
  }

  async function onFileChange(event: Event) {
    importError = null;
    importPreview = null;
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    importFile = file;
    if (!file) return;
    try {
      const { parseTvTimeExport } = await import('$lib/data/tvtime-import');
      const text = await file.text();
      const entries = parseTvTimeExport(text);
      importPreview = { count: entries.length };
    } catch (err) {
      importError = err instanceof Error ? err.message : $t('onboarding.importBadFile');
      importFile = null;
    }
  }

  function clearFile() {
    importFile = null;
    importPreview = null;
    importError = null;
  }

  async function finalize(withImport: boolean) {
    if (submitting) return;
    if (!name.trim()) {
      errorMsg = $t('onboarding.nameRequired');
      return;
    }
    submitting = true;
    errorMsg = null;
    try {
      if (withImport && importFile) await api.importTvTime(importFile);
      await api.completeOnboarding(name.trim(), avatar);
      await invalidateAll();
      await goto('/');
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : $t('common.error');
      submitting = false;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void finalize(true);
  }

  function skipImport(event: MouseEvent) {
    event.preventDefault();
    importFile = null;
    importPreview = null;
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

    <div>
      <h1>{$t('onboarding.hello')}<br /><strong>{$t('onboarding.tagline')}</strong></h1>
      <p class="onboarding__lead">{$t('onboarding.lead')}</p>
    </div>

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
      />
    </div>

    <div class="field">
      <span class="field__label">{$t('onboarding.avatarLabel')}</span>
      <AvatarPicker {initial} onChange={(d) => (avatar = d)} />
      <span class="field__help">{$t('onboarding.avatarHelp')}</span>
    </div>

    <details class="onboarding__import">
      <summary>
        <span class="onboarding__import-title">{$t('onboarding.importTitle')}</span>
        <span class="onboarding__import-meta">{$t('common.optional')}</span>
      </summary>

      <div class="onboarding__import-body">
        <p class="field__help" style="margin-bottom: var(--s-3)">{$t('onboarding.importIntro')}</p>

        <ol class="onboarding__howto">
          <li>
            {$t('onboarding.importStep1Pre')}<strong>{$t('onboarding.importStep1Account')}</strong
            >{$t('onboarding.importStep1Sep1')}<strong>{$t('onboarding.importStep1Privacy')}</strong
            >{$t('onboarding.importStep1Sep2')}<strong
              >{$t('onboarding.importStep1Download')}</strong
            >{$t('onboarding.importStep1Suf')}
          </li>
          <li>{$t('onboarding.importStep2')}</li>
          <li>
            {$t('onboarding.importStep3Pre')}<code>tracking.json</code>{$t(
              'onboarding.importStep3Or'
            )}<code>seen_episode.json</code>{$t('onboarding.importStep3Suf')}
          </li>
          <li>{$t('onboarding.importStep4')}</li>
        </ol>

        <label class="onboarding__file-row">
          <input
            type="file"
            accept=".json,application/json"
            onchange={onFileChange}
            disabled={submitting}
          />
        </label>

        {#if importError}
          <p class="field__help" style="color: var(--bw-red); margin-top: var(--s-2)">
            {importError}
          </p>
        {/if}

        {#if importPreview}
          <div class="onboarding__import-result">
            <strong>{importPreview.count}</strong>
            <span
              >{$t('onboarding.importPreview', { count: importPreview.count }).replace(
                /^\d+\s*/,
                ''
              )}</span
            >
            <button type="button" class="link-btn" onclick={clearFile}>{$t('common.cancel')}</button
            >
          </div>
        {/if}
      </div>
    </details>

    <div class="spacer"></div>

    {#if errorMsg}
      <p class="field__help" style="color: var(--bw-red)">{errorMsg}</p>
    {/if}

    <button type="submit" class="btn btn--accent btn--block btn--lg" disabled={submitting}>
      {submitting
        ? $t('onboarding.submitting')
        : importFile
          ? $t('onboarding.submitWithImport')
          : $t('onboarding.submit')}
    </button>
    {#if importFile}
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
