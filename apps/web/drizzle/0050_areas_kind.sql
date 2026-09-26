ALTER TABLE `blocks` ADD `kind` text DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE `blocks` ADD `x_ft` real;--> statement-breakpoint
ALTER TABLE `blocks` ADD `y_ft` real;--> statement-breakpoint
ALTER TABLE `blocks` ADD `rotation_deg` real;--> statement-breakpoint
ALTER TABLE `blocks` ADD `bed_style` text;--> statement-breakpoint
ALTER TABLE `fields` ADD `kind` text DEFAULT 'field' NOT NULL;--> statement-breakpoint
ALTER TABLE `fields` ADD `details_json` text;--> statement-breakpoint
ALTER TABLE `fields` ADD `perimeter_ft` real;