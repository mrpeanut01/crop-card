ALTER TABLE `animal_health_events` ADD `stock_product_text` text;--> statement-breakpoint
ALTER TABLE `animal_production_logs` ADD `declared_use` text;--> statement-breakpoint
UPDATE `animal_production_logs` SET `declared_use` = `use` WHERE `use` IN ('food', 'sale');--> statement-breakpoint
UPDATE `animal_production_logs` SET `declared_use` = (
	SELECT json_extract(d.`snapshot_json`, '$.before.use') FROM `record_deletions` d
	WHERE d.`record_kind` = 'animal-production' AND d.`record_id` = `animal_production_logs`.`id`
		AND d.`owner_id` = `animal_production_logs`.`owner_id`
		AND json_valid(d.`snapshot_json`)
		AND json_extract(d.`snapshot_json`, '$.before.use') IN ('food', 'sale')
	ORDER BY d.`deleted_at` LIMIT 1
) WHERE `declared_use` IS NULL AND EXISTS (
	SELECT 1 FROM `record_deletions` d
	WHERE d.`record_kind` = 'animal-production' AND d.`record_id` = `animal_production_logs`.`id`
		AND d.`owner_id` = `animal_production_logs`.`owner_id`
		AND json_valid(d.`snapshot_json`)
		AND json_extract(d.`snapshot_json`, '$.before.use') IN ('food', 'sale')
);
