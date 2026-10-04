CREATE TEMP TABLE `oc1_removed` (`template_key` text, `title` text NOT NULL, `body` text NOT NULL);
--> statement-breakpoint
INSERT INTO `oc1_removed` VALUES
	(NULL, 'Dormant oil spray window', 'Apply horticultural oil before bud-break to smother overwintering scale + mites. Temp ≥ 40°F for 24 h after spray.'),
	(NULL, 'Pre-bloom fungicide (silver-tip → green-tip)', 'Scab + powdery mildew protectant. Captan / sulfur per label.'),
	(NULL, 'Bloom fungicide (pink → petal-fall)', 'Critical scab + fire blight window. NO insecticides during open bloom — protect pollinators.'),
	(NULL, 'Summer cover spray (codling moth + apple maggot)', 'Pheromone trap counts drive timing. Avoid pollinator activity — spray after sunset.'),
	(NULL, 'Pre-harvest cover spray (sooty blotch / flyspeck)', 'Final fungicide pass; respect the 14-day pre-harvest interval per product.'),
	('crop:pear-bartlett:seasonal:dormant-oil', 'Dormant oil + copper', 'Pear psylla overwinters under bark scales. Copper for fire blight.'),
	('crop:pear-bartlett:seasonal:bloom', 'Bloom — Streptomycin/Apogee fire-blight gate', 'MaryBlyt or Cougar Blight model triggers; never apply broad-spectrum insecticide during open bloom.'),
	('crop:pear-bartlett:seasonal:fire-blight-cover', 'Post-bloom fire-blight cover', 'Apogee plant growth regulator suppresses shoot blight.'),
	('crop:peach-redhaven:seasonal:dormant-spray', 'Dormant copper + oil', 'Peach leaf curl preventive — must be applied before bud swell.'),
	('crop:peach-redhaven:seasonal:shuck-split-cover', 'Shuck-split cover spray', 'Brown rot + plum curculio window. Captan + insecticide tank-mix per label.'),
	('crop:peach-redhaven:seasonal:summer-cover', 'Summer cover sprays (10–14 d intervals)', 'Brown rot, oriental fruit moth. Adjust by trap counts.'),
	('crop:peach-redhaven:seasonal:pre-harvest', 'Pre-harvest brown rot', 'DMI fungicide 3 wk + 7 d before harvest. Respect 3-day PHI.'),
	('crop:blueberry-bluecrop:seasonal:mummy-berry-cover', 'Mummy berry primary infection cover', 'FRAC 3 (myclobutanil) or FRAC 11 — alternate per stewardship. Begin at green-tip stage.'),
	('crop:blueberry-bluecrop:seasonal:anthracnose-pre-bloom', 'Anthracnose pre-bloom', 'Captan or chlorothalonil. Critical for fruit-rot prevention.'),
	('crop:grape-concord:seasonal:downy-mildew-cover', 'Pre-bloom mancozeb / copper', 'Black rot + downy mildew + powdery mildew window. M03 mancozeb 3 lb/A.'),
	('crop:grape-concord:seasonal:post-bloom-cover', 'Post-bloom cover', 'FRAC 11 strobilurin or FRAC 7 SDHI — alternate from M03.');
--> statement-breakpoint
CREATE TEMP TABLE `oc1_edited` (`template_key` text, `old_title` text NOT NULL, `new_title` text NOT NULL, `old_body` text NOT NULL, `new_body` text NOT NULL);
--> statement-breakpoint
INSERT INTO `oc1_edited` VALUES
	(NULL, 'Hand or chemical fruit thinning', 'Hand fruit thinning', 'Thin to one fruit per cluster at 10–15 mm fruit size for size + return-bloom.', 'Thin to one fruit per cluster for size + return-bloom.'),
	(NULL, 'Apple harvest window', 'Apple harvest window', 'Pick to color + brix indicators (above). Cool within 24 h.', 'Pick to color + brix indicators (above).'),
	('crop:peach-redhaven:seasonal:harvest', 'Peach harvest window', 'Peach harvest window', 'Ground-color yellow-orange + slight give = pick. Refrigerate within 4 h.', 'Ground-color yellow-orange + slight give = pick.'),
	('crop:blueberry-bluecrop:seasonal:swd-monitoring', 'Spotted-wing drosophila trap monitoring', 'Spotted-wing drosophila trap monitoring', 'Apple cider vinegar + yeast traps; 7-d insecticide intervals once SWD detected.', 'Apple cider vinegar + yeast traps.'),
	('crop:grape-concord:seasonal:leaf-pull', 'Pull basal leaves around clusters', 'Pull basal leaves around clusters', 'Improves spray penetration + reduces botrytis.', 'Reduces botrytis.'),
	('crop:raspberry-heritage:seasonal:swd-monitoring', 'SWD trap + spray decision', 'SWD trap monitoring', 'Spotted-wing drosophila is the dominant ripe-fruit pest. Pyrethroids on 5–7 d intervals during ripening.', 'Spotted-wing drosophila is the dominant ripe-fruit pest.');
--> statement-breakpoint
CREATE TEMP TABLE `oc1_abort` (`id` text PRIMARY KEY);
--> statement-breakpoint
INSERT OR IGNORE INTO `oc1_abort` SELECT `t`.`id` FROM `tasks` `t` WHERE `t`.`completed_at` IS NULL AND `t`.`aborted_at` IS NULL AND (
	`t`.`plugin_template_key` IN (SELECT `template_key` FROM `oc1_removed` WHERE `template_key` IS NOT NULL)
	OR ((`t`.`plugin_template_key` LIKE 'derived:orchard-task:%' OR `t`.`plugin_template_key` LIKE 'derived:seasonal-task:%') AND EXISTS (
		SELECT 1 FROM `oc1_removed` `r` WHERE `t`.`body` = `r`.`body` OR substr(`t`.`title`, 1, length(`r`.`title`) + 3) = `r`.`title` || ' — '
	))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `oc1_abort` SELECT `id` FROM `tasks` WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND `linked_to_task_id` IN (SELECT `id` FROM `oc1_abort`);
--> statement-breakpoint
UPDATE `tasks` SET `aborted_at` = unixepoch() * 1000, `abort_reason` = 'Removed: unsourced spray advice'
WHERE `id` IN (SELECT `id` FROM `oc1_abort`);
--> statement-breakpoint
UPDATE `tasks` SET
	`title` = coalesce((SELECT `e`.`new_title` FROM `oc1_edited` `e` WHERE `e`.`template_key` = `tasks`.`plugin_template_key` AND `e`.`old_title` = `tasks`.`title`), `title`),
	`body` = coalesce((SELECT `e`.`new_body` FROM `oc1_edited` `e` WHERE `e`.`template_key` = `tasks`.`plugin_template_key` AND `e`.`old_body` = `tasks`.`body`), `body`)
WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND `plugin_template_key` IN (SELECT `template_key` FROM `oc1_edited` WHERE `template_key` IS NOT NULL);
--> statement-breakpoint
UPDATE `tasks` SET
	`title` = coalesce((SELECT `e`.`new_title` || substr(`tasks`.`title`, length(`e`.`old_title`) + 1) FROM `oc1_edited` `e` WHERE `e`.`old_title` <> `e`.`new_title` AND substr(`tasks`.`title`, 1, length(`e`.`old_title`) + 3) = `e`.`old_title` || ' — '), `title`),
	`body` = coalesce((SELECT `e`.`new_body` FROM `oc1_edited` `e` WHERE `e`.`old_body` = `tasks`.`body`), `body`)
WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND (`plugin_template_key` LIKE 'derived:orchard-task:%' OR `plugin_template_key` LIKE 'derived:seasonal-task:%');
--> statement-breakpoint
DROP TABLE `oc1_abort`;
--> statement-breakpoint
DROP TABLE `oc1_edited`;
--> statement-breakpoint
DROP TABLE `oc1_removed`;
