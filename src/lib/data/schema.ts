import { sqliteTable, integer, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const series = sqliteTable(
  'series',
  {
    tmdbId: integer('tmdb_id').primaryKey(),
    name: text('name').notNull(),
    originalName: text('original_name'),
    overview: text('overview'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    firstAirDate: text('first_air_date'),
    lastAirDate: text('last_air_date'),
    status: text('status'),
    network: text('network'),
    numberOfSeasons: integer('number_of_seasons'),
    numberOfEpisodes: integer('number_of_episodes'),
    runtimeMinutes: integer('runtime_minutes'),
    /* TMDB `origin_country` (ISO 3166-1 alpha-2, first entry). Used to
     * resolve the broadcaster's timezone so episode air dates can be
     * turned into absolute release instants. NULL on rows synced before
     * this column existed; backfilled on the next sync / detail open. */
    originCountry: text('origin_country'),
    /* Whether TMDB metadata flags this as anime (animation + Japanese
     * origin — see detectAnime). Lets the profile split the anime count
     * out of the series count. NULL on rows synced before this column
     * existed; backfilled on the next sync / follow. */
    isAnime: integer('is_anime', { mode: 'boolean' }),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }),
    removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' })
  },
  (t) => ({
    addedIdx: index('series_added_idx').on(t.addedAt),
    removedIdx: index('series_removed_idx').on(t.removedAt)
  })
);

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seriesTmdbId: integer('series_tmdb_id')
      .notNull()
      .references(() => series.tmdbId, { onDelete: 'cascade' }),
    tmdbId: integer('tmdb_id'),
    seasonNumber: integer('season_number').notNull(),
    name: text('name'),
    overview: text('overview'),
    airDate: text('air_date'),
    episodeCount: integer('episode_count'),
    posterPath: text('poster_path')
  },
  (t) => ({
    uniq: uniqueIndex('seasons_series_num_uniq').on(t.seriesTmdbId, t.seasonNumber)
  })
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    seriesTmdbId: integer('series_tmdb_id').notNull(),
    tmdbId: integer('tmdb_id'),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    name: text('name'),
    overview: text('overview'),
    airDate: text('air_date'),
    /* Absolute instant (epoch ms) the episode is assumed to become
     * available — air_date interpreted at a default broadcast hour in the
     * origin timezone. Gating on this instant (vs the bare date string)
     * is what stops evening foreign releases from surfacing a day early.
     * NULL when the origin timezone is unknown → row falls back to the
     * legacy air_date comparison. See utils/airtime.ts. */
    releaseAt: integer('release_at'),
    runtimeMinutes: integer('runtime_minutes'),
    stillPath: text('still_path')
  },
  (t) => ({
    uniq: uniqueIndex('episodes_series_se_uniq').on(
      t.seriesTmdbId,
      t.seasonNumber,
      t.episodeNumber
    ),
    airIdx: index('episodes_air_idx').on(t.airDate),
    releaseIdx: index('episodes_release_idx').on(t.releaseAt)
  })
);

export const watched = sqliteTable(
  'watched',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    watchedAt: integer('watched_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (t) => ({
    epUniq: uniqueIndex('watched_episode_uniq').on(t.episodeId),
    atIdx: index('watched_at_idx').on(t.watchedAt)
  })
);

export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type Season = typeof seasons.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
export type Watched = typeof watched.$inferSelect;
