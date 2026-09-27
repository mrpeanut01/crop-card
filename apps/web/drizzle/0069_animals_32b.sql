ALTER TABLE `animal_groups` ADD `food_producing` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `from_group_id` text REFERENCES animal_groups(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `animal_locations` ADD `to_group_id` text REFERENCES animal_groups(id) ON DELETE set null;