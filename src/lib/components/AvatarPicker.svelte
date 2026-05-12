<script lang="ts">
  import { calcAvatarTargetSize, MAX_AVATAR_LENGTH } from '$lib/utils/avatar';

  interface Props {
    initial?: string;
    current?: string | null;
    /** Called with a JPEG data URL (or empty string after "Supprimer"). */
    onChange: (dataUrl: string) => void;
    size?: number;
    quality?: number;
  }
  let { initial = '?', current = null, onChange, size = 256, quality = 0.85 }: Props = $props();

  let inputEl: HTMLInputElement;
  let preview = $state<string | null>(null);
  let error = $state<string | null>(null);
  $effect(() => {
    preview = current ?? null;
  });

  async function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image illisible'));
      };
      img.src = url;
    });
  }

  function resize(img: HTMLImageElement): string {
    const { tw, th } = calcAvatarTargetSize(img.naturalWidth, img.naturalHeight, size);
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas non disponible');
    ctx.drawImage(img, 0, 0, tw, th);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function handleFile(file: File) {
    error = null;
    if (!file.type.startsWith('image/')) {
      error = 'Format non supporté';
      return;
    }
    try {
      const img = await loadImage(file);
      const dataUrl = resize(img);
      if (dataUrl.length > MAX_AVATAR_LENGTH) {
        error = 'Image trop volumineuse après compression';
        return;
      }
      preview = dataUrl;
      onChange(dataUrl);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Erreur';
    }
  }

  function remove() {
    preview = null;
    onChange('');
    if (inputEl) inputEl.value = '';
  }
</script>

<div class="avatar-upload">
  <div
    class="avatar"
    aria-hidden="true"
    style={preview ? `background-image: url('${preview}')` : ''}
  >
    {preview ? '' : initial}
  </div>
  <div style="display: flex; flex-direction: column; gap: var(--s-2); align-items: flex-start">
    <input
      bind:this={inputEl}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="sr-only"
      onchange={(e) => {
        const f = (e.currentTarget as HTMLInputElement).files?.[0];
        if (f) handleFile(f);
      }}
    />
    <button type="button" class="btn btn--secondary" onclick={() => inputEl.click()}>
      {preview ? 'Changer' : 'Choisir une image'}
    </button>
    {#if preview}
      <button
        type="button"
        class="btn btn--secondary"
        style="font-size: 0.7rem; padding: var(--s-2) var(--s-3)"
        onclick={remove}>Supprimer</button
      >
    {/if}
    {#if error}
      <span class="field__help" style="color: var(--bw-red)">{error}</span>
    {/if}
  </div>
</div>
