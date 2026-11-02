-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `device_token` VARCHAR(128) NOT NULL,
    `client_type` VARCHAR(32) NOT NULL DEFAULT 'wechat_mp',
    `status` TINYINT NOT NULL DEFAULT 1,
    `last_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `device_tokens_device_token_key`(`device_token`),
    INDEX `device_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NULL,
    `gender` VARCHAR(16) NULL,
    `birth` DATE NULL,
    `lottery_type` VARCHAR(16) NULL,
    `divination_system` VARCHAR(32) NULL,
    `rawPayload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_configs_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `lottery_type` VARCHAR(16) NOT NULL,
    `lottery_name` VARCHAR(32) NULL,
    `period` VARCHAR(32) NOT NULL,
    `draw_date` DATE NULL,
    `bet_count` INTEGER NOT NULL DEFAULT 0,
    `multiplier` INTEGER NOT NULL DEFAULT 1,
    `total_amount_cent` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `win_amount_cent` INTEGER NOT NULL DEFAULT 0,
    `prize_level` VARCHAR(32) NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'ocr',
    `photo_url` VARCHAR(512) NULL,
    `ocr_status` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tickets_user_id_idx`(`user_id`),
    INDEX `tickets_lottery_type_period_idx`(`lottery_type`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_bets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ticket_id` BIGINT NOT NULL,
    `bet_index` INTEGER NOT NULL DEFAULT 1,
    `red_balls` JSON NOT NULL,
    `blue_balls` JSON NOT NULL,
    `mult` INTEGER NOT NULL DEFAULT 1,
    `matched_red` INTEGER NOT NULL DEFAULT 0,
    `matched_blue` INTEGER NOT NULL DEFAULT 0,
    `is_win` TINYINT NOT NULL DEFAULT 0,
    `prize_level` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_bets_ticket_id_idx`(`ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `draw_results` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `lottery_type` VARCHAR(16) NOT NULL,
    `period` VARCHAR(32) NOT NULL,
    `draw_date` DATE NULL,
    `red_balls` JSON NOT NULL,
    `blue_balls` JSON NOT NULL,
    `prize_pool_cent` BIGINT NULL,
    `source_name` VARCHAR(64) NULL,
    `source_url` VARCHAR(512) NULL,
    `source_raw` JSON NULL,
    `sync_status` VARCHAR(16) NOT NULL DEFAULT 'synced',
    `synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `draw_results_lottery_type_period_key`(`lottery_type`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lottery_status` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `lottery_type` VARCHAR(16) NOT NULL,
    `current_issue` VARCHAR(32) NULL,
    `period_text` VARCHAR(64) NULL,
    `draw_date` DATETIME(3) NULL,
    `prize_pool_amount` VARCHAR(32) NULL,
    `winning_numbers` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lottery_status_lottery_type_key`(`lottery_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `redeem_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ticket_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `lottery_type` VARCHAR(16) NOT NULL,
    `period` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `amount_cent` INTEGER NOT NULL DEFAULT 0,
    `prize_level` VARCHAR(32) NULL,
    `deadline_date` DATE NULL,
    `redeem_channel` VARCHAR(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `redeem_records_ticket_id_key`(`ticket_id`),
    INDEX `redeem_records_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recommendation_cache` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `recommend_date` DATE NOT NULL,
    `lottery_type` VARCHAR(16) NOT NULL,
    `divination_system` VARCHAR(32) NOT NULL,
    `result_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recommendation_cache_user_id_recommend_date_lottery_type_div_key`(`user_id`, `recommend_date`, `lottery_type`, `divination_system`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `heatmap_daily_stats` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `date` DATE NOT NULL,
    `level` TINYINT NOT NULL DEFAULT 0,
    `amount_cent` INTEGER NOT NULL DEFAULT 0,
    `ticket_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `heatmap_daily_stats_user_id_date_key`(`user_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `job_name` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `job_runs_job_name_started_at_idx`(`job_name`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_call_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(32) NOT NULL,
    `endpoint` VARCHAR(128) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `cost_ms` INTEGER NOT NULL,
    `request` JSON NULL,
    `response` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `external_call_logs_provider_created_at_idx`(`provider`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `device_tokens` ADD CONSTRAINT `device_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_configs` ADD CONSTRAINT `user_configs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_bets` ADD CONSTRAINT `ticket_bets_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redeem_records` ADD CONSTRAINT `redeem_records_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redeem_records` ADD CONSTRAINT `redeem_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_cache` ADD CONSTRAINT `recommendation_cache_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `heatmap_daily_stats` ADD CONSTRAINT `heatmap_daily_stats_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
