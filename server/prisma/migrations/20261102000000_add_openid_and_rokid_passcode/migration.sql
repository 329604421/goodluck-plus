-- ============================================================
-- 补齐两处早期直接用 SQL 在生产库上手建的结构，使其能被迁移系统复现。
--
--   1. users.openid          微信登录身份（同一 openid 多端同一用户）
--   2. rokid_passcode 表     眼镜端口令绑定（code_hash = sha256(userId + code + salt)）
--
-- ⚠️ 已存在的部署：这两处当初是手工 ALTER / CREATE 的，请把本迁移标记为已应用
--    （`npx prisma migrate resolve --applied 20261102000000_add_openid_and_rokid_passcode`），
--    不要直接执行，否则会因列/表已存在而失败。
-- ============================================================

-- AlterTable
ALTER TABLE `users` ADD COLUMN `openid` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_openid_key` ON `users`(`openid`);

-- CreateTable
CREATE TABLE `rokid_passcode` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rokid_passcode_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
