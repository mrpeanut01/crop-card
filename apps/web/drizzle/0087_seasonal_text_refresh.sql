CREATE TEMP TABLE `m0087_edited` (`template_key` text, `old_title` text NOT NULL, `new_title` text NOT NULL, `old_body` text, `new_body` text);
--> statement-breakpoint
INSERT INTO `m0087_edited` VALUES
	('crop:strawberry-jewel:seasonal:row-renovation', 'Renovate matted rows post-harvest', 'Renovate matted rows post-harvest', 'Mow tops, narrow rows to 12 in, fertilize, irrigate. Within 1 wk of last harvest.', 'Within 1 week of the last harvest, mow off the leaves; then narrow the rows, fertilize and irrigate.'),
	('crop:strawberry-jewel:seasonal:winter-mulch', 'Apply straw winter mulch', 'Apply straw winter mulch', '3 in straw after 2–3 hard frosts but before sustained cold.', 'Spread straw over the plants after the first freezing weather in fall, before sustained cold.'),
	('crop:strawberry-jewel:seasonal:frost-watch', 'Bloom frost watch', 'Bloom frost watch', 'Open blossoms freeze at 30 °F; row cover + irrigation can save a crop.', 'Open blossoms are damaged at 30 °F. Cover rows on frost nights. Overhead irrigation protects only while water runs continuously until temperatures rise above freezing; stopping too early can do more damage than not irrigating.'),
	('crop:raspberry-heritage:seasonal:mow-canes-down', 'Mow primocane raspberry to ground (winter)', 'Mow primocane raspberry to ground (winter)', 'Single-crop management: cut all canes 1 in tall after dormancy; new canes will fruit Aug-Oct.', 'Single-crop management: cut all canes to the ground after dormancy; new canes will fruit Aug-Oct.'),
	('crop:raspberry-heritage:seasonal:harvest', 'Fall raspberry harvest', 'Fall raspberry harvest', 'Pick every 2–3 d. Cool berries to 32–34 °F within 1 h.', 'Pick ripe berries often. Cool the fruit as soon as possible after harvest.'),
	('crop:blackberry-triple-crown:seasonal:tip-primocanes', 'Tip primocanes at 4 ft', 'Tip primocanes at about 5 ft', 'Encourages lateral branching for next year''s crop.', 'Encourages lateral branching for next year''s crop.'),
	('crop:garlic-music-hardneck:seasonal:garlic-plant', 'Plant garlic cloves', 'Plant garlic cloves', 'Mid-Oct → mid-Nov. Mulch 4–6 in straw after planting.', 'Mid-Oct → mid-Nov. Mulch with a thick layer of straw after planting.'),
	('crop:blueberry-bluecrop:seasonal:winter-prune', 'Winter pruning (dormant)', 'Winter pruning (dormant)', 'Remove 1/6 oldest canes; thin twiggy growth. Aim for 6–8 productive canes per mature bush.', 'Prune out one of every six existing canes, oldest first, close to the ground; thin twiggy growth. A mature bush should have 10 to 15 canes.'),
	('crop:blueberry-bluecrop:seasonal:harvest', 'Harvest window', 'Harvest window', 'Pick every 5–7 d; berries fully blue + drop into hand without pull.', 'Pick every five to seven days, more often if birds are a problem; berries fully blue + drop into hand without pull.'),
	('crop:grape-concord:seasonal:winter-prune', 'Winter pruning (dormant)', 'Winter pruning (dormant)', 'Cane prune to 4-arm Kniffin or umbrella Kniffin. 80% of last year''s wood removed.', 'Cane prune to four-arm Kniffin or umbrella Kniffin. Remove most of last year''s wood.'),
	('crop:grape-concord:seasonal:early-shoot-thin', 'Shoot thinning at 6 in', 'Shoot thinning at 5 to 7 in', 'Remove non-count shoots and weak shoots from cordon to balance crop.', 'Remove non-count shoots and weak shoots from cordon to balance crop.'),
	('crop:grape-concord:seasonal:harvest', 'Concord harvest', 'Concord harvest', 'Brix ≥ 16 + characteristic foxy aroma. Single-pass mechanical or hand.', 'At least 16° Brix (the juice processor minimum) + characteristic foxy aroma. Single-pass mechanical or hand.'),
	(NULL, 'Apple harvest window', 'Apple harvest window', 'Pick to color + brix indicators (above).', 'Pick by the harvest cues in this crop''s Care Guide.');
--> statement-breakpoint
UPDATE `tasks` SET
	`title` = coalesce((SELECT `e`.`new_title` FROM `m0087_edited` `e` WHERE `e`.`template_key` = `tasks`.`plugin_template_key` AND `e`.`old_title` = `tasks`.`title`), `title`),
	`body` = CASE WHEN EXISTS (SELECT 1 FROM `m0087_edited` `e` WHERE `e`.`template_key` = `tasks`.`plugin_template_key` AND `e`.`old_body` IS `tasks`.`body`) THEN (SELECT `e`.`new_body` FROM `m0087_edited` `e` WHERE `e`.`template_key` = `tasks`.`plugin_template_key` AND `e`.`old_body` IS `tasks`.`body`) ELSE `body` END
WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND `plugin_template_key` IN (SELECT `template_key` FROM `m0087_edited` WHERE `template_key` IS NOT NULL);
--> statement-breakpoint
UPDATE `tasks` SET
	`title` = coalesce((SELECT `e`.`new_title` || substr(`tasks`.`title`, length(`e`.`old_title`) + 1) FROM `m0087_edited` `e` WHERE `e`.`old_title` <> `e`.`new_title` AND substr(`tasks`.`title`, 1, length(`e`.`old_title`) + 3) = `e`.`old_title` || ' — '), `title`),
	`body` = coalesce((SELECT `e`.`new_body` FROM `m0087_edited` `e` WHERE `e`.`old_body` = `tasks`.`body`), `body`)
WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND (`plugin_template_key` LIKE 'derived:orchard-task:%' OR `plugin_template_key` LIKE 'derived:seasonal-task:%');
--> statement-breakpoint
DROP TABLE `m0087_edited`;
