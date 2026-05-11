<script lang="ts">
  import Mark from '$lib/components/Mark.svelte';
  import { initialOf } from '$lib/utils/format';

  let name = $state('');
  const initial = $derived(name ? initialOf(name) : '?');
</script>

<svelte:head><title>Bienvenue — Episode</title></svelte:head>

<main class="app">
  <form class="onboarding" method="POST" action="?/complete">
    <Mark />

    <div class="onboarding__hero" aria-hidden="true">
      <div class="shape shape--circle"></div>
      <div class="shape shape--square"></div>
      <div class="shape shape--tri"></div>
    </div>

    <div>
      <h1>Bonjour.<br /><strong>Suivez vos séries.</strong></h1>
      <p class="onboarding__lead">
        Sans pub, sans tracking. Vos données restent chez vous.
      </p>
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
      <div class="avatar-upload">
        <div class="avatar" aria-hidden="true">{initial}</div>
        <span class="field__help">Optionnel — configurable plus tard dans Paramètres.</span>
      </div>
    </div>

    <div class="spacer"></div>

    <button type="submit" class="btn btn--accent btn--block btn--lg">Commencer →</button>
    <a href="/settings" class="btn btn--secondary btn--block" style="margin-top: var(--s-2)"
      >Importer mes données plus tard</a
    >
  </form>
</main>
