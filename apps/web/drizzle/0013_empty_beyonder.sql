CREATE TABLE `taxonomy_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_terms_domain_name_idx` ON `taxonomy_terms` (`domain`, `name` COLLATE NOCASE);
--> statement-breakpoint
ALTER TABLE `equipment` ADD `type_id` text;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `type_id` text;--> statement-breakpoint
-- Seed inventory:seed types from canonical crop families (HCD / spec §safety).
INSERT INTO `taxonomy_terms` (`id`, `domain`, `name`, `description`, `is_default`) VALUES
  ('t-inv-seed-corn',                'inventory:seed', 'Corn',                NULL, 1),
  ('t-inv-seed-cucurbit',            'inventory:seed', 'Cucurbits',           'squash, melon, cucumber, pumpkin, gourd', 1),
  ('t-inv-seed-legume',              'inventory:seed', 'Legumes',             'bean, pea, soybean', 1),
  ('t-inv-seed-broadleaf-companion', 'inventory:seed', 'Broadleaf companion', 'sunflower, marigold, etc.', 1),
  ('t-inv-seed-orchard',             'inventory:seed', 'Orchard',             'tree fruit (apple, pear, etc.)', 1),
  ('t-inv-seed-cover-grass',         'inventory:seed', 'Cover crop — grass',  'rye, oats (cover), triticale', 1),
  ('t-inv-seed-cover-legume',        'inventory:seed', 'Cover crop — legume', 'clover, vetch, peas (cover)', 1),
  ('t-inv-seed-solanaceae',          'inventory:seed', 'Solanaceae',          'tomato, pepper, eggplant, potato, tomatillo', 1),
  ('t-inv-seed-brassica',            'inventory:seed', 'Brassicas',           'cabbage, broccoli, cauliflower, kale, collards, radish, turnip, mustard', 1),
  ('t-inv-seed-allium',              'inventory:seed', 'Alliums',             'onion, garlic, leek, shallot, scallion', 1),
  ('t-inv-seed-leafy-green',         'inventory:seed', 'Leafy greens',        'lettuce, spinach, swiss chard, arugula', 1),
  ('t-inv-seed-root',                'inventory:seed', 'Root crops',          'carrot, beet, parsnip, sweet potato', 1),
  ('t-inv-seed-apiaceae',            'inventory:seed', 'Apiaceae',            'celery, parsley, dill, fennel, cilantro', 1),
  ('t-inv-seed-small-fruit',         'inventory:seed', 'Small fruit',         'strawberry, blueberry, currant, gooseberry, elderberry', 1),
  ('t-inv-seed-bramble',             'inventory:seed', 'Brambles',            'raspberry, blackberry', 1),
  ('t-inv-seed-vine-fruit',          'inventory:seed', 'Vine fruit',          'grape, kiwi', 1),
  ('t-inv-seed-stone-fruit',         'inventory:seed', 'Stone fruit',         'peach, plum, cherry, apricot, nectarine', 1),
  ('t-inv-seed-cereal-grain',        'inventory:seed', 'Cereal grain',        'wheat, oats, barley, rye, sorghum, millet', 1),
  ('t-inv-seed-forage',              'inventory:seed', 'Forage',              'alfalfa, clover hay, timothy, orchard grass', 1),
  ('t-inv-seed-herb-culinary',       'inventory:seed', 'Culinary herbs',      'basil, oregano, thyme, rosemary, sage, mint, chives', 1);
--> statement-breakpoint
INSERT INTO `taxonomy_terms` (`id`, `domain`, `name`, `description`, `is_default`) VALUES
  ('t-inv-herb-burndown',     'inventory:herbicide', 'Burndown',     'non-selective pre-plant (e.g. glyphosate)', 1),
  ('t-inv-herb-pre-emergent', 'inventory:herbicide', 'Pre-emergent', 'soil-applied before weeds emerge', 1),
  ('t-inv-herb-post-emergent','inventory:herbicide', 'Post-emergent','foliar after weed emergence', 1),
  ('t-inv-herb-selective',    'inventory:herbicide', 'Selective',    'safe on listed crop, kills target weeds', 1),
  ('t-inv-insect-contact',    'inventory:insecticide', 'Contact',     'kills on direct contact', 1),
  ('t-inv-insect-systemic',   'inventory:insecticide', 'Systemic',    'translocated through plant tissue', 1),
  ('t-inv-insect-bt',         'inventory:insecticide', 'Bt / biological', 'OMRI-eligible biological control', 1),
  ('t-inv-fung-protectant',   'inventory:fungicide', 'Protectant',  'preventive, surface-only', 1),
  ('t-inv-fung-systemic',     'inventory:fungicide', 'Systemic',    'curative + protective inside plant', 1),
  ('t-inv-fert-granular',     'inventory:fertilizer', 'Granular',    'dry prill / pellet', 1),
  ('t-inv-fert-liquid',       'inventory:fertilizer', 'Liquid',      'fluid concentrate', 1),
  ('t-inv-fert-compost',      'inventory:fertilizer', 'Compost / manure', 'organic amendment', 1);
--> statement-breakpoint
-- Seed equipment types from existing hardcoded enum.
INSERT INTO `taxonomy_terms` (`id`, `domain`, `name`, `description`, `is_default`) VALUES
  ('t-eq-sprayer',    'equipment', 'Sprayer',    'boom, backpack, or handheld sprayer', 1),
  ('t-eq-planter',    'equipment', 'Planter',    'row-crop planter or transplanter', 1),
  ('t-eq-drill',      'equipment', 'Drill',      'grain drill or seed drill', 1),
  ('t-eq-rake',       'equipment', 'Rake',       'hay rake (rotary, parallel-bar)', 1),
  ('t-eq-baler',      'equipment', 'Baler',      'small-square, large-round, or large-square', 1),
  ('t-eq-tractor',    'equipment', 'Tractor',    NULL, 1),
  ('t-eq-mower',      'equipment', 'Mower',      'mower or mower-conditioner', 1),
  ('t-eq-irrigation', 'equipment', 'Irrigation', 'drip, overhead, or pivot system', 1),
  ('t-eq-other',      'equipment', 'Other',      NULL, 1);
--> statement-breakpoint
-- Backfill type_id on existing equipment rows by matching the legacy enum value.
UPDATE `equipment` SET `type_id` = (
  SELECT `id` FROM `taxonomy_terms`
  WHERE `domain` = 'equipment' AND lower(`name`) = lower(`equipment`.`type`) LIMIT 1
) WHERE `type_id` IS NULL;