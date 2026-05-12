import nodeAdapter from '@sveltejs/adapter-node';
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const target = process.env.EPISODE_TARGET ?? 'server';
const isLocal = target === 'local';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: isLocal
      ? staticAdapter({
          pages: 'build',
          assets: 'build',
          fallback: 'index.html',
          precompress: false,
          strict: false
        })
      : nodeAdapter({
          out: 'build',
          precompress: false,
          envPrefix: 'EPISODE_'
        }),
    csrf: { trustedOrigins: [] }
  }
};

export default config;
