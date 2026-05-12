<script lang="ts">
  import { goto } from '$app/navigation';
  import Mark from '$lib/components/Mark.svelte';
  import AvatarPicker from '$lib/components/AvatarPicker.svelte';
  import { initialOf } from '$lib/utils/format';
  import * as api from '$lib/api';

  let name = $state('');
  let avatar = $state('');
  let submitting = $state(false);
  let errorMsg = $state<string | null>(null);
  const initial = $derived(name ? initialOf(name) : '?');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      errorMsg = 'Le nom est requis';
      return;
    }
    submitting = true;
    errorMsg = null;
    try {
      await api.completeOnboarding(name.trim(), avatar);
      await goto('/');
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Erreur';
      submitting = false;
    }
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
      <input type="hidden" name="avatar" value={avatar} />
      <span class="field__help">Optionnel — modifiable plus tard dans Paramètres.</span>
    </div>

    <div class="spacer"></div>

    {#if errorMsg}
      <p class="field__help" style="color: var(--bw-red)">{errorMsg}</p>
    {/if}

    <button type="submit" class="btn btn--accent btn--block btn--lg" disabled={submitting}>
      {submitting ? 'Enregistrement…' : 'Commencer →'}
    </button>
    <a href="/settings" class="btn btn--secondary btn--block" style="margin-top: var(--s-2)"
      >Importer mes données plus tard</a
    >
  </form>
</main>
