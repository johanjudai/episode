ALTER TABLE `episodes` ADD `release_at` integer;--> statement-breakpoint
CREATE INDEX `episodes_release_idx` ON `episodes` (`release_at`);--> statement-breakpoint
ALTER TABLE `series` ADD `origin_country` text;