UPDATE `tasks` SET `plugin_template_key` = 'derived:seasonal-task:' || substr(`tasks`.`plugin_template_key`, 22)
WHERE `plugin_template_key` LIKE 'derived:orchard-task:%' AND NOT EXISTS (
	SELECT 1 FROM `tasks` `d` WHERE `d`.`owner_id` = `tasks`.`owner_id` AND `d`.`plugin_template_key` = 'derived:seasonal-task:' || substr(`tasks`.`plugin_template_key`, 22)
);
