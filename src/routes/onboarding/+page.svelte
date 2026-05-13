<script lang="ts">
  import { goto } from '$app/navigation';
  import Mark from '$lib/components/Mark.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import * as api from '$lib/api';

  let name = $state('');
  let avatar = $state('');
  let importFile = $state<File | null>(null);
  let importPreview = $state<{ count: number } | null>(null);
  let importError = $state<string | null>(null);
  let submitting = $state(false);
  let errorMsg = $state<string | null>(null);
  const initial = $derived(name ? initialOf(name) : '?');

  /** Parse the file as soon as it's picked so the user sees a count
   *  before they commit, and so we catch a bad file early. */
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
      importError =
        err instanceof Error ? err.message : "Fichier illisible — c'est bien le JSON TV Time ?";
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
      errorMsg = 'Le nom est requis';
      return;
    }
    submitting = true;
    errorMsg = null;
    try {
      if (withImport && importFile) {
        await api.importTvTime(importFile);
      }
      await api.completeOnboarding(name.trim(), avatar);
      await goto('/');
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Erreur';
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

<svelte:head><title>Bienvenue — Episode</title></svelte:head>

<main class="app">
  <form class="onboarding" onsubmit={submit}>
    <Mark />

    <div class="onboarding__hero" aria-hidden="true">
      <div class="shape shape--circle"></div>
      <div class="shape shape--square"></div>
      <div class="shape shape--tri"></div>
    </div>

    <div>
      <h1>Bonjour.<br /><strong>Suivez vos séries.</strong></h1>
      <p class="onboarding__lead">Sans pub, sans tracking. Vos données restent chez vous.</p>
    </div>

    <div class="field">
      <label class="field__label" for="name">Votre prénom</label>
      <input
        class="field__input"
        type="text"
        name="name"
        id="name"
        placeholder="Pierre"
        required
        maxlength="80"
        autocomplete="given-name"
        bind:value={name}
      />
    </div>

    <div class="field">
      <span class="field__label">Photo de profil</span>
      <AvatarPicker {initial} onChange={(d) => (avatar = d)} />
      <span class="field__help">Optionnel — modifiable plus tard dans Paramètres.</span>
    </div>

    <details class="onboarding__import">
      <summary>
        <span class="onboarding__import-title">Importer depuis TV Time</span>
        <span class="onboarding__import-meta">Optionnel</span>
      </summary>

      <div class="onboarding__import-body">
        <p class="field__help" style="margin-bottom: var(--s-3)">
          Vous arrivez de TV Time ? Récupérez votre historique avant d'effacer leur app.
        </p>

        <ol class="onboarding__howto">
          <li>
            Dans TV Time → <strong>Compte</strong> → <strong>Confidentialité</strong> →
            <strong>Télécharger mes données</strong>.
          </li>
          <li>
            Vous recevrez un email avec un lien de téléchargement (peut prendre quelques heures).
          </li>
          <li>
            Décompressez l'archive ZIP. Cherchez le fichier <code>tracking.json</code> ou
            <code>seen_episode.json</code>.
          </li>
          <li>Déposez-le ici.</li>
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
              >épisode{importPreview.count > 1 ? 's' : ''} détecté{importPreview.count > 1
                ? 's'
                : ''}.</span
            >
            <button type="button" class="link-btn" onclick={clearFile}>Annuler</button>
          </div>
        {/if}
      </div>
    </details>

    <div class="spacer"></div>

    {#if errorMsg}
      <p class="field__help" style="color: var(--bw-red)">{errorMsg}</p>
    {/if}

    <button type="submit" class="btn btn--accent btn--block btn--lg" disabled={submitting}>
      {submitting ? 'Enregistrement…' : importFile ? 'Importer et commencer →' : 'Commencer →'}
    </button>
    {#if importFile}
      <button
        type="button"
        class="btn btn--secondary btn--block"
        style="margin-top: var(--s-2)"
        onclick={skipImport}
        disabled={submitting}>Continuer sans importer</button
      >
    {/if}
  </form>
</main>
