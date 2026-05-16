PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`usd_estimate` real DEFAULT 0 NOT NULL,
	`success` integer DEFAULT true NOT NULL,
	`error_class` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ai_call_log`("id", "owner_id", "user_id", "endpoint", "model", "input_tokens", "cached_input_tokens", "output_tokens", "usd_estimate", "success", "error_class", "created_at") SELECT "id", "owner_id", "user_id", "endpoint", "model", "input_tokens", "cached_input_tokens", "output_tokens", "usd_estimate", "success", "error_class", "created_at" FROM `ai_call_log`;--> statement-breakpoint
DROP TABLE `ai_call_log`;--> statement-breakpoint
ALTER TABLE `__new_ai_call_log` RENAME TO `ai_call_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_call_log_owner_created_idx` ON `ai_call_log` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("owner_id", "key", "value", "updated_at") SELECT "owner_id", "key", "value", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
CREATE TABLE `__new_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`acres` integer,
	`block_label` text,
	`field_id` text,
	`geometry_geojson` text,
	`tillage_method` text DEFAULT 'conventional' NOT NULL,
	`east_west_index` integer,
	`north_south_index` integer,
	`axes_locked` integer DEFAULT false NOT NULL,
	`sun_exposure` text,
	`slope_percent` real,
	`slope_aspect_deg` real,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_blocks`("id", "owner_id", "name", "acres", "block_label", "field_id", "geometry_geojson", "tillage_method", "east_west_index", "north_south_index", "axes_locked", "sun_exposure", "slope_percent", "slope_aspect_deg") SELECT "id", "owner_id", "name", "acres", "block_label", "field_id", "geometry_geojson", "tillage_method", "east_west_index", "north_south_index", "axes_locked", "sun_exposure", "slope_percent", "slope_aspect_deg" FROM `blocks`;--> statement-breakpoint
DROP TABLE `blocks`;--> statement-breakpoint
ALTER TABLE `__new_blocks` RENAME TO `blocks`;--> statement-breakpoint
CREATE INDEX `blocks_owner_name_idx` ON `blocks` (`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `blocks_owner_field_idx` ON `blocks` (`owner_id`,`field_id`);--> statement-breakpoint
CREATE TABLE `__new_crop_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`crop_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`role` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_crop_equipment`("id", "owner_id", "crop_id", "equipment_id", "role", "notes", "created_at") SELECT "id", "owner_id", "crop_id", "equipment_id", "role", "notes", "created_at" FROM `crop_equipment`;--> statement-breakpoint
DROP TABLE `crop_equipment`;--> statement-breakpoint
ALTER TABLE `__new_crop_equipment` RENAME TO `crop_equipment`;--> statement-breakpoint
CREATE INDEX `crop_equipment_owner_crop_idx` ON `crop_equipment` (`owner_id`,`crop_id`);--> statement-breakpoint
CREATE TABLE `__new_crops` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_plugin_id` text NOT NULL,
	`variety_display_name` text NOT NULL,
	`planting_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`harvested_at` integer,
	`archived_at` integer,
	`quantity_planted_hundredths` integer,
	`quantity_unit` text,
	`group_id` text,
	`group_role` text,
	`group_offset_days` integer,
	`group_system_kind` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_crops`("id", "owner_id", "block_id", "crop_plugin_id", "variety_display_name", "planting_date", "status", "harvested_at", "archived_at", "quantity_planted_hundredths", "quantity_unit", "group_id", "group_role", "group_offset_days", "group_system_kind") SELECT "id", "owner_id", "block_id", "crop_plugin_id", "variety_display_name", "planting_date", "status", "harvested_at", "archived_at", "quantity_planted_hundredths", "quantity_unit", "group_id", "group_role", "group_offset_days", "group_system_kind" FROM `crops`;--> statement-breakpoint
DROP TABLE `crops`;--> statement-breakpoint
ALTER TABLE `__new_crops` RENAME TO `crops`;--> statement-breakpoint
CREATE INDEX `crops_owner_block_idx` ON `crops` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `crops_owner_status_idx` ON `crops` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`type_id` text,
	`label` text NOT NULL,
	`spec_json` text,
	`notes` text,
	`retired_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_equipment`("id", "owner_id", "type", "type_id", "label", "spec_json", "notes", "retired_at") SELECT "id", "owner_id", "type", "type_id", "label", "spec_json", "notes", "retired_at" FROM `equipment`;--> statement-breakpoint
DROP TABLE `equipment`;--> statement-breakpoint
ALTER TABLE `__new_equipment` RENAME TO `equipment`;--> statement-breakpoint
CREATE INDEX `equipment_owner_type_idx` ON `equipment` (`owner_id`,`type`);--> statement-breakpoint
CREATE TABLE `__new_equipment_log` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`kind` text NOT NULL,
	`performed_by_id` text,
	`notes` text,
	`payload_json` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_equipment_log`("id", "owner_id", "equipment_id", "occurred_at", "kind", "performed_by_id", "notes", "payload_json") SELECT "id", "owner_id", "equipment_id", "occurred_at", "kind", "performed_by_id", "notes", "payload_json" FROM `equipment_log`;--> statement-breakpoint
DROP TABLE `equipment_log`;--> statement-breakpoint
ALTER TABLE `__new_equipment_log` RENAME TO `equipment_log`;--> statement-breakpoint
CREATE INDEX `equipment_log_owner_equip_idx` ON `equipment_log` (`owner_id`,`equipment_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_equipment_state` (
	`equipment_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`hour_meter` integer,
	`last_chemistry_class` text,
	`last_used_at` integer,
	`last_decon_at` integer,
	`calibrated_gpa` integer,
	`calibration_date` integer,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_equipment_state`("equipment_id", "owner_id", "hour_meter", "last_chemistry_class", "last_used_at", "last_decon_at", "calibrated_gpa", "calibration_date") SELECT "equipment_id", "owner_id", "hour_meter", "last_chemistry_class", "last_used_at", "last_decon_at", "calibrated_gpa", "calibration_date" FROM `equipment_state`;--> statement-breakpoint
DROP TABLE `equipment_state`;--> statement-breakpoint
ALTER TABLE `__new_equipment_state` RENAME TO `equipment_state`;--> statement-breakpoint
CREATE INDEX `equipment_state_owner_idx` ON `equipment_state` (`owner_id`);--> statement-breakpoint
CREATE TABLE `__new_fertility_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`occurred_at` integer NOT NULL,
	`source` text NOT NULL,
	`stock_item_id` text,
	`rate_per_acre_hundredths` integer NOT NULL,
	`rate_unit` text NOT NULL,
	`n_delivered_hundredths` integer DEFAULT 0 NOT NULL,
	`p_delivered_hundredths` integer DEFAULT 0 NOT NULL,
	`k_delivered_hundredths` integer DEFAULT 0 NOT NULL,
	`performed_by_id` text,
	`notes` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_fertility_applications`("id", "owner_id", "block_id", "crop_id", "occurred_at", "source", "stock_item_id", "rate_per_acre_hundredths", "rate_unit", "n_delivered_hundredths", "p_delivered_hundredths", "k_delivered_hundredths", "performed_by_id", "notes") SELECT "id", "owner_id", "block_id", "crop_id", "occurred_at", "source", "stock_item_id", "rate_per_acre_hundredths", "rate_unit", "n_delivered_hundredths", "p_delivered_hundredths", "k_delivered_hundredths", "performed_by_id", "notes" FROM `fertility_applications`;--> statement-breakpoint
DROP TABLE `fertility_applications`;--> statement-breakpoint
ALTER TABLE `__new_fertility_applications` RENAME TO `fertility_applications`;--> statement-breakpoint
CREATE INDEX `fertility_applications_owner_block_idx` ON `fertility_applications` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `__new_fertility_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`applies_to_year` integer NOT NULL,
	`source` text NOT NULL,
	`crop_plugin_id` text,
	`n_lb_per_acre_hundredths` integer DEFAULT 0 NOT NULL,
	`p_lb_per_acre_hundredths` integer DEFAULT 0 NOT NULL,
	`k_lb_per_acre_hundredths` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_fertility_credits`("id", "owner_id", "block_id", "applies_to_year", "source", "crop_plugin_id", "n_lb_per_acre_hundredths", "p_lb_per_acre_hundredths", "k_lb_per_acre_hundredths", "notes", "created_at") SELECT "id", "owner_id", "block_id", "applies_to_year", "source", "crop_plugin_id", "n_lb_per_acre_hundredths", "p_lb_per_acre_hundredths", "k_lb_per_acre_hundredths", "notes", "created_at" FROM `fertility_credits`;--> statement-breakpoint
DROP TABLE `fertility_credits`;--> statement-breakpoint
ALTER TABLE `__new_fertility_credits` RENAME TO `fertility_credits`;--> statement-breakpoint
CREATE INDEX `fertility_credits_owner_block_year_idx` ON `fertility_credits` (`owner_id`,`block_id`,`applies_to_year`);--> statement-breakpoint
CREATE TABLE `__new_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`acres` integer,
	`location` text,
	`notes` text,
	`geometry_geojson` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_fields`("id", "owner_id", "name", "acres", "location", "notes", "geometry_geojson", "created_at") SELECT "id", "owner_id", "name", "acres", "location", "notes", "geometry_geojson", "created_at" FROM `fields`;--> statement-breakpoint
DROP TABLE `fields`;--> statement-breakpoint
ALTER TABLE `__new_fields` RENAME TO `fields`;--> statement-breakpoint
CREATE INDEX `fields_owner_idx` ON `fields` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_harvest_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`crop_plugin_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`quantity` text,
	`lot_number` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_harvest_events`("id", "owner_id", "block_id", "crop_id", "crop_plugin_id", "occurred_at", "quantity", "lot_number") SELECT "id", "owner_id", "block_id", "crop_id", "crop_plugin_id", "occurred_at", "quantity", "lot_number" FROM `harvest_events`;--> statement-breakpoint
DROP TABLE `harvest_events`;--> statement-breakpoint
ALTER TABLE `__new_harvest_events` RENAME TO `harvest_events`;--> statement-breakpoint
CREATE INDEX `harvest_events_owner_occurred_idx` ON `harvest_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_hay_cuttings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`crop_plugin_id` text NOT NULL,
	`cutting_number` integer NOT NULL,
	`year` integer NOT NULL,
	`status` text DEFAULT 'mowing' NOT NULL,
	`mow_at` integer,
	`ted_at` integer,
	`rake_at` integer,
	`bale_at` integer,
	`stored_at` integer,
	`bale_type` text,
	`bales_quantity` integer,
	`bale_moisture_hundredths` integer,
	`weather_forecast_json` text,
	`performed_by_id` text,
	`rules_version` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_hay_cuttings`("id", "owner_id", "block_id", "crop_id", "crop_plugin_id", "cutting_number", "year", "status", "mow_at", "ted_at", "rake_at", "bale_at", "stored_at", "bale_type", "bales_quantity", "bale_moisture_hundredths", "weather_forecast_json", "performed_by_id", "rules_version", "notes", "created_at") SELECT "id", "owner_id", "block_id", "crop_id", "crop_plugin_id", "cutting_number", "year", "status", "mow_at", "ted_at", "rake_at", "bale_at", "stored_at", "bale_type", "bales_quantity", "bale_moisture_hundredths", "weather_forecast_json", "performed_by_id", "rules_version", "notes", "created_at" FROM `hay_cuttings`;--> statement-breakpoint
DROP TABLE `hay_cuttings`;--> statement-breakpoint
ALTER TABLE `__new_hay_cuttings` RENAME TO `hay_cuttings`;--> statement-breakpoint
CREATE INDEX `hay_cuttings_owner_block_year_idx` ON `hay_cuttings` (`owner_id`,`block_id`,`year`);--> statement-breakpoint
CREATE TABLE `__new_insecticide_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`sprayer_id` text,
	`performed_by_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`products_json` text NOT NULL,
	`scout_observation_json` text,
	`conditions_json` text NOT NULL,
	`re_entry_clear_at` integer,
	`pre_harvest_clear_at` integer,
	`rules_version` text NOT NULL,
	`plugin_hashes_json` text NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sprayer_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_insecticide_events`("id", "owner_id", "block_id", "crop_id", "sprayer_id", "performed_by_id", "occurred_at", "products_json", "scout_observation_json", "conditions_json", "re_entry_clear_at", "pre_harvest_clear_at", "rules_version", "plugin_hashes_json", "locked_at") SELECT "id", "owner_id", "block_id", "crop_id", "sprayer_id", "performed_by_id", "occurred_at", "products_json", "scout_observation_json", "conditions_json", "re_entry_clear_at", "pre_harvest_clear_at", "rules_version", "plugin_hashes_json", "locked_at" FROM `insecticide_events`;--> statement-breakpoint
DROP TABLE `insecticide_events`;--> statement-breakpoint
ALTER TABLE `__new_insecticide_events` RENAME TO `insecticide_events`;--> statement-breakpoint
CREATE INDEX `insecticide_events_owner_occurred_idx` ON `insecticide_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `insecticide_events_owner_block_idx` ON `insecticide_events` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `__new_pending_calibrations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`submitted_by_id` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`calibrated_gpa` integer NOT NULL,
	`spread_inches` integer,
	`ounces_collected` integer,
	`notes` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pending_calibrations`("id", "owner_id", "equipment_id", "submitted_by_id", "submitted_at", "calibrated_gpa", "spread_inches", "ounces_collected", "notes") SELECT "id", "owner_id", "equipment_id", "submitted_by_id", "submitted_at", "calibrated_gpa", "spread_inches", "ounces_collected", "notes" FROM `pending_calibrations`;--> statement-breakpoint
DROP TABLE `pending_calibrations`;--> statement-breakpoint
ALTER TABLE `__new_pending_calibrations` RENAME TO `pending_calibrations`;--> statement-breakpoint
CREATE INDEX `pending_calibrations_owner_idx` ON `pending_calibrations` (`owner_id`);--> statement-breakpoint
CREATE TABLE `__new_plugin_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_plugin_overrides`("id", "owner_id", "plugin_id", "kind", "payload_json", "hash", "created_at") SELECT "id", "owner_id", "plugin_id", "kind", "payload_json", "hash", "created_at" FROM `plugin_overrides`;--> statement-breakpoint
DROP TABLE `plugin_overrides`;--> statement-breakpoint
ALTER TABLE `__new_plugin_overrides` RENAME TO `plugin_overrides`;--> statement-breakpoint
CREATE INDEX `plugin_overrides_owner_plugin_idx` ON `plugin_overrides` (`owner_id`,`plugin_id`);--> statement-breakpoint
CREATE TABLE `__new_shade_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'tree-row' NOT NULL,
	`geometry_geojson` text,
	`field_id` text,
	`height_ft` real NOT NULL,
	`opacity` real DEFAULT 0.7 NOT NULL,
	`is_deciduous` integer DEFAULT false NOT NULL,
	`leaf_on_day_of_year` integer DEFAULT 105 NOT NULL,
	`leaf_off_day_of_year` integer DEFAULT 305 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_shade_sources`("id", "owner_id", "name", "kind", "geometry_geojson", "field_id", "height_ft", "opacity", "is_deciduous", "leaf_on_day_of_year", "leaf_off_day_of_year", "notes", "created_at", "updated_at") SELECT "id", "owner_id", "name", "kind", "geometry_geojson", "field_id", "height_ft", "opacity", "is_deciduous", "leaf_on_day_of_year", "leaf_off_day_of_year", "notes", "created_at", "updated_at" FROM `shade_sources`;--> statement-breakpoint
DROP TABLE `shade_sources`;--> statement-breakpoint
ALTER TABLE `__new_shade_sources` RENAME TO `shade_sources`;--> statement-breakpoint
CREATE INDEX `shade_sources_owner_idx` ON `shade_sources` (`owner_id`);--> statement-breakpoint
CREATE TABLE `__new_soil_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`sampled_at` integer NOT NULL,
	`lab` text,
	`report_pdf_url` text,
	`ph_hundredths` integer,
	`cec_hundredths` integer,
	`organic_matter_pct_hundredths` integer,
	`nitrate_ppm` integer,
	`phosphorus_ppm` integer,
	`potassium_ppm` integer,
	`notes` text,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_soil_tests`("id", "owner_id", "block_id", "sampled_at", "lab", "report_pdf_url", "ph_hundredths", "cec_hundredths", "organic_matter_pct_hundredths", "nitrate_ppm", "phosphorus_ppm", "potassium_ppm", "notes") SELECT "id", "owner_id", "block_id", "sampled_at", "lab", "report_pdf_url", "ph_hundredths", "cec_hundredths", "organic_matter_pct_hundredths", "nitrate_ppm", "phosphorus_ppm", "potassium_ppm", "notes" FROM `soil_tests`;--> statement-breakpoint
DROP TABLE `soil_tests`;--> statement-breakpoint
ALTER TABLE `__new_soil_tests` RENAME TO `soil_tests`;--> statement-breakpoint
CREATE INDEX `soil_tests_owner_block_idx` ON `soil_tests` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `__new_spray_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`block_id` text NOT NULL,
	`crop_id` text,
	`sprayer_id` text NOT NULL,
	`performed_by_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`products_json` text NOT NULL,
	`conditions_json` text NOT NULL,
	`rules_version` text NOT NULL,
	`plugin_hashes_json` text NOT NULL,
	`custom_rate_override` integer DEFAULT false NOT NULL,
	`locked_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sprayer_id`) REFERENCES `sprayers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_spray_events`("id", "owner_id", "block_id", "crop_id", "sprayer_id", "performed_by_id", "occurred_at", "products_json", "conditions_json", "rules_version", "plugin_hashes_json", "custom_rate_override", "locked_at") SELECT "id", "owner_id", "block_id", "crop_id", "sprayer_id", "performed_by_id", "occurred_at", "products_json", "conditions_json", "rules_version", "plugin_hashes_json", "custom_rate_override", "locked_at" FROM `spray_events`;--> statement-breakpoint
DROP TABLE `spray_events`;--> statement-breakpoint
ALTER TABLE `__new_spray_events` RENAME TO `spray_events`;--> statement-breakpoint
CREATE INDEX `spray_events_owner_occurred_idx` ON `spray_events` (`owner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `spray_events_owner_block_idx` ON `spray_events` (`owner_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `__new_sprayers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`calibrated_gpa` integer,
	`calibration_date` integer,
	`last_chemistry_class` text,
	`last_sprayed_at` integer,
	`last_decon_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_sprayers`("id", "owner_id", "label", "calibrated_gpa", "calibration_date", "last_chemistry_class", "last_sprayed_at", "last_decon_at") SELECT "id", "owner_id", "label", "calibrated_gpa", "calibration_date", "last_chemistry_class", "last_sprayed_at", "last_decon_at" FROM `sprayers`;--> statement-breakpoint
DROP TABLE `sprayers`;--> statement-breakpoint
ALTER TABLE `__new_sprayers` RENAME TO `sprayers`;--> statement-breakpoint
CREATE INDEX `sprayers_owner_idx` ON `sprayers` (`owner_id`);--> statement-breakpoint
CREATE TABLE `__new_stock_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`plugin_id` text,
	`category` text NOT NULL,
	`display_name` text NOT NULL,
	`default_unit` text NOT NULL,
	`reorder_threshold_hundredths` integer,
	`notes` text,
	`barcode` text,
	`type_id` text,
	`metadata_json` text,
	`short_name` text,
	`active_ingredients_json` text,
	`formulation_json` text
);
--> statement-breakpoint
INSERT INTO `__new_stock_items`("id", "owner_id", "plugin_id", "category", "display_name", "default_unit", "reorder_threshold_hundredths", "notes", "barcode", "type_id", "metadata_json", "short_name", "active_ingredients_json", "formulation_json") SELECT "id", "owner_id", "plugin_id", "category", "display_name", "default_unit", "reorder_threshold_hundredths", "notes", "barcode", "type_id", "metadata_json", "short_name", "active_ingredients_json", "formulation_json" FROM `stock_items`;--> statement-breakpoint
DROP TABLE `stock_items`;--> statement-breakpoint
ALTER TABLE `__new_stock_items` RENAME TO `stock_items`;--> statement-breakpoint
CREATE INDEX `stock_items_owner_category_idx` ON `stock_items` (`owner_id`,`category`);--> statement-breakpoint
CREATE INDEX `stock_items_owner_plugin_idx` ON `stock_items` (`owner_id`,`plugin_id`);--> statement-breakpoint
CREATE INDEX `stock_items_owner_barcode_idx` ON `stock_items` (`owner_id`,`barcode`);--> statement-breakpoint
CREATE TABLE `__new_stock_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`lot_number` text,
	`expires_at` integer,
	`received_at` integer NOT NULL,
	`received_quantity_hundredths` integer NOT NULL,
	`received_cost_cents` integer,
	`supplier` text,
	`notes` text,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_stock_lots`("id", "owner_id", "stock_item_id", "lot_number", "expires_at", "received_at", "received_quantity_hundredths", "received_cost_cents", "supplier", "notes") SELECT "id", "owner_id", "stock_item_id", "lot_number", "expires_at", "received_at", "received_quantity_hundredths", "received_cost_cents", "supplier", "notes" FROM `stock_lots`;--> statement-breakpoint
DROP TABLE `stock_lots`;--> statement-breakpoint
ALTER TABLE `__new_stock_lots` RENAME TO `stock_lots`;--> statement-breakpoint
CREATE INDEX `stock_lots_owner_item_idx` ON `stock_lots` (`owner_id`,`stock_item_id`);--> statement-breakpoint
CREATE INDEX `stock_lots_owner_expiry_idx` ON `stock_lots` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`stock_lot_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`delta_hundredths` integer NOT NULL,
	`reason` text NOT NULL,
	`spray_event_id` text,
	`insecticide_event_id` text,
	`fertility_application_id` text,
	`crop_id` text,
	`performed_by_id` text,
	`notes` text,
	FOREIGN KEY (`stock_lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spray_event_id`) REFERENCES `spray_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insecticide_event_id`) REFERENCES `insecticide_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fertility_application_id`) REFERENCES `fertility_applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "owner_id", "stock_lot_id", "occurred_at", "delta_hundredths", "reason", "spray_event_id", "insecticide_event_id", "fertility_application_id", "crop_id", "performed_by_id", "notes") SELECT "id", "owner_id", "stock_lot_id", "occurred_at", "delta_hundredths", "reason", "spray_event_id", "insecticide_event_id", "fertility_application_id", "crop_id", "performed_by_id", "notes" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
CREATE INDEX `stock_movements_owner_lot_idx` ON `stock_movements` (`owner_id`,`stock_lot_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_superadmin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`superadmin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`owner_id` text,
	`target_table` text,
	`target_id` text,
	`payload_json` text,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`superadmin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_superadmin_audit`("id", "superadmin_user_id", "action", "owner_id", "target_table", "target_id", "payload_json", "at") SELECT "id", "superadmin_user_id", "action", "owner_id", "target_table", "target_id", "payload_json", "at" FROM `superadmin_audit`;--> statement-breakpoint
DROP TABLE `superadmin_audit`;--> statement-breakpoint
ALTER TABLE `__new_superadmin_audit` RENAME TO `superadmin_audit`;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`kind` text NOT NULL,
	`linked_to_task_id` text,
	`crop_id` text,
	`block_id` text,
	`equipment_id` text,
	`scheduled_for` integer NOT NULL,
	`completed_at` integer,
	`aborted_at` integer,
	`abort_reason` text,
	`related_event_table` text,
	`related_event_id` text,
	`plugin_template_key` text,
	`recurrence_json` text,
	`user_overridden` integer DEFAULT false NOT NULL,
	`stale_anchor` integer DEFAULT false NOT NULL,
	`superseded_by_task_id` text,
	`created_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`crop_id`) REFERENCES `crops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "owner_id", "title", "body", "kind", "linked_to_task_id", "crop_id", "block_id", "equipment_id", "scheduled_for", "completed_at", "aborted_at", "abort_reason", "related_event_table", "related_event_id", "plugin_template_key", "recurrence_json", "user_overridden", "stale_anchor", "superseded_by_task_id", "created_by_id", "created_at") SELECT "id", "owner_id", "title", "body", "kind", "linked_to_task_id", "crop_id", "block_id", "equipment_id", "scheduled_for", "completed_at", "aborted_at", "abort_reason", "related_event_table", "related_event_id", "plugin_template_key", "recurrence_json", "user_overridden", "stale_anchor", "superseded_by_task_id", "created_by_id", "created_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_owner_scheduled_idx` ON `tasks` (`owner_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `tasks_owner_crop_idx` ON `tasks` (`owner_id`,`crop_id`);