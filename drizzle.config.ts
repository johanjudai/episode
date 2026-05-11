import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/server/db/schema.ts',
  out: './src/lib/server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.EPISODE_DB_URL ?? './data/episode.sqlite'
  },
  verbose: true,
  strict: true
});
