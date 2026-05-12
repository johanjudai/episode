CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`series_tmdb_id` integer NOT NULL,
	`tmdb_id` integer,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`air_date` text,
	`runtime_minutes` integer,
	`still_path` text,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_series_se_uniq` ON `episodes` (`series_tmdb_id`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE INDEX `episodes_air_idx` ON `episodes` (`air_date`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_tmdb_id` integer NOT NULL,
	`tmdb_id` integer,
	`season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`air_date` text,
	`episode_count` integer,
	`poster_path` text,
	FOREIGN KEY (`series_tmdb_id`) REFERENCES `series`(`tmdb_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_series_num_uniq` ON `seasons` (`series_tmdb_id`,`season_number`);--> statement-breakpoint
CREATE TABLE `series` (
	`tmdb_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`original_name` text,
	`overview` text,
	`poster_path` text,
	`backdrop_path` text,
	`first_air_date` text,
	`last_air_date` text,
	`status` text,
	`network` text,
	`number_of_seasons` integer,
	`number_of_episodes` integer,
	`runtime_minutes` integer,
	`added_at` integer,
	`removed_at` integer,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE INDEX `series_added_idx` ON `series` (`added_at`);--> statement-breakpoint
CREATE INDEX `series_removed_idx` ON `series` (`removed_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watched` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`episode_id` integer NOT NULL,
	`watched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watched_episode_uniq` ON `watched` (`episode_id`);--> statement-breakpoint
CREATE INDEX `watched_at_idx` ON `watched` (`watched_at`);