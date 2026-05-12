import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/data/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.EPISODE_DB_URL ?? './data/episode.sqlite'
  },
  verbose: true,
  strict: true
});
