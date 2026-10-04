UPDATE `tasks` SET `aborted_at` = unixepoch() * 1000, `abort_reason` = 'Removed: unsourced spray advice'
WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND `linked_to_task_id` IN (
	SELECT `id` FROM `tasks` WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND `plugin_template_key` IN (
	'crop:apple-orchard:seasonal:dormant-oil',
	'crop:apple-orchard:seasonal:pre-bloom-fungicide',
	'crop:apple-orchard:seasonal:bloom-fungicide',
	'crop:apple-orchard:seasonal:summer-cover-spray',
	'crop:apple-orchard:seasonal:pre-harvest-cover-spray',
	'crop:pear-bartlett:seasonal:dormant-oil',
	'crop:pear-bartlett:seasonal:bloom',
	'crop:pear-bartlett:seasonal:fire-blight-cover',
	'crop:peach-redhaven:seasonal:dormant-spray',
	'crop:peach-redhaven:seasonal:shuck-split-cover',
	'crop:peach-redhaven:seasonal:summer-cover',
	'crop:peach-redhaven:seasonal:pre-harvest',
	'crop:blueberry-bluecrop:seasonal:mummy-berry-cover',
	'crop:blueberry-bluecrop:seasonal:anthracnose-pre-bloom',
	'crop:grape-concord:seasonal:downy-mildew-cover',
	'crop:grape-concord:seasonal:post-bloom-cover'
	)
);--> statement-breakpoint
UPDATE `tasks` SET `aborted_at` = unixepoch() * 1000, `abort_reason` = 'Removed: unsourced spray advice'
WHERE `completed_at` IS NULL AND `aborted_at` IS NULL AND `plugin_template_key` IN (
	'crop:apple-orchard:seasonal:dormant-oil',
	'crop:apple-orchard:seasonal:pre-bloom-fungicide',
	'crop:apple-orchard:seasonal:bloom-fungicide',
	'crop:apple-orchard:seasonal:summer-cover-spray',
	'crop:apple-orchard:seasonal:pre-harvest-cover-spray',
	'crop:pear-bartlett:seasonal:dormant-oil',
	'crop:pear-bartlett:seasonal:bloom',
	'crop:pear-bartlett:seasonal:fire-blight-cover',
	'crop:peach-redhaven:seasonal:dormant-spray',
	'crop:peach-redhaven:seasonal:shuck-split-cover',
	'crop:peach-redhaven:seasonal:summer-cover',
	'crop:peach-redhaven:seasonal:pre-harvest',
	'crop:blueberry-bluecrop:seasonal:mummy-berry-cover',
	'crop:blueberry-bluecrop:seasonal:anthracnose-pre-bloom',
	'crop:grape-concord:seasonal:downy-mildew-cover',
	'crop:grape-concord:seasonal:post-bloom-cover'
);
