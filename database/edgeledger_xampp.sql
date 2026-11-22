-- EdgeLedger development database for XAMPP (MySQL/MariaDB).
-- Import this file with phpMyAdmin's Import tab or the mysql command-line client.
-- The sample account and trades mirror the frontend prototype; they are not live trading data.

CREATE DATABASE IF NOT EXISTS edgeledger
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE edgeledger;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NULL,
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  platform VARCHAR(80) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  starting_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_accounts_user_id (user_id),
  CONSTRAINT fk_accounts_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS strategies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_strategies_account_name (account_id, name),
  CONSTRAINT fk_strategies_account
    FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trades (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  strategy_id BIGINT UNSIGNED NULL,
  external_id VARCHAR(80) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side ENUM('long', 'short') NOT NULL,
  trading_session VARCHAR(40) NOT NULL,
  opened_at DATETIME NOT NULL,
  closed_at DATETIME NULL,
  entry_price DECIMAL(18,8) NOT NULL,
  exit_price DECIMAL(18,8) NULL,
  quantity DECIMAL(18,8) NOT NULL,
  pnl DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  r_multiple DECIMAL(10,4) NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'closed',
  before_image_path VARCHAR(255) NULL,
  after_image_path VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trades_account_external_id (account_id, external_id),
  KEY ix_trades_account_closed_at (account_id, closed_at),
  KEY ix_trades_account_status (account_id, status),
  KEY ix_trades_strategy_id (strategy_id),
  CONSTRAINT fk_trades_account
    FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_trades_strategy
    FOREIGN KEY (strategy_id) REFERENCES strategies (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- This sample profile has no password and cannot be used to sign in.
INSERT IGNORE INTO users (id, name, email, password_hash)
VALUES (1, 'Sample Trader', 'sample@example.test', NULL);

INSERT IGNORE INTO accounts (id, user_id, name, platform, currency, starting_balance)
VALUES (1, 1, 'Sample account', 'MT5', 'USD', 25000.00);

INSERT IGNORE INTO strategies (id, account_id, name, notes)
VALUES
  (1, 1, 'Opening Range Breakout', 'Trade a break of the opening range only when momentum confirms the move.'),
  (2, 1, 'London Reversal', 'Fade an early London extreme back toward the prior session range.'),
  (3, 1, 'Trend Pullback', 'Enter with the higher-timeframe trend after a shallow pullback.');

INSERT IGNORE INTO trades
  (id, account_id, strategy_id, external_id, symbol, side, trading_session,
   opened_at, closed_at, entry_price, exit_price, quantity, pnl, r_multiple, status)
VALUES
  (1, 1, 1, 'T-1042', 'EURUSD', 'long', 'London', '2026-10-16 08:12:00', '2026-10-16 11:05:00', 1.08342000, 1.08610000, 1.00000000, 180.00, 1.2000, 'closed'),
  (2, 1, 2, 'T-1043', 'GBPUSD', 'short', 'London', '2026-10-17 09:02:00', '2026-10-17 10:40:00', 1.32880000, 1.33040000, 0.80000000, -95.00, -0.6000, 'closed'),
  (3, 1, 3, 'T-1044', 'XAUUSD', 'long', 'New York', '2026-10-20 14:15:00', '2026-10-20 16:45:00', 2684.20000000, 2698.40000000, 0.30000000, 420.00, 1.8000, 'closed'),
  (4, 1, 1, 'T-1045', 'NAS100', 'short', 'New York', '2026-10-21 15:05:00', '2026-10-21 15:50:00', 20110.00000000, 20185.00000000, 0.50000000, -500.00, -1.0000, 'closed'),
  (5, 1, 3, 'T-1046', 'EURUSD', 'long', 'London', '2026-10-22 08:40:00', '2026-10-22 12:10:00', 1.08710000, 1.08960000, 1.20000000, 260.00, 1.1000, 'closed'),
  (6, 1, 2, 'T-1047', 'GBPJPY', 'long', 'London', '2026-10-23 07:55:00', '2026-10-23 09:30:00', 197.42000000, 197.78000000, 0.70000000, 140.00, 0.8000, 'closed'),
  (7, 1, 1, 'T-1048', 'XAUUSD', 'short', 'London', '2026-10-27 08:20:00', '2026-10-27 09:10:00', 2712.50000000, 2718.10000000, 0.20000000, -150.00, -0.7000, 'closed'),
  (8, 1, 3, 'T-1049', 'US30', 'long', 'New York', '2026-10-28 15:35:00', '2026-10-28 18:05:00', 47240.00000000, 47410.00000000, 0.50000000, 510.00, 2.1000, 'closed'),
  (9, 1, 2, 'T-1050', 'EURUSD', 'short', 'London', '2026-10-29 09:15:00', '2026-10-29 11:00:00', 1.09240000, 1.09110000, 1.00000000, 95.00, 0.5000, 'closed'),
  (10, 1, 1, 'T-1051', 'NAS100', 'long', 'New York', '2026-10-30 14:50:00', '2026-10-30 16:05:00', 20340.00000000, 20195.00000000, 1.00000000, -900.00, -1.0000, 'closed'),
  (11, 1, 3, 'T-1052', 'GBPUSD', 'long', 'London', '2026-11-03 08:25:00', '2026-11-03 13:15:00', 1.31420000, 1.31740000, 0.90000000, 275.00, 1.3000, 'closed'),
  (12, 1, 1, 'T-1053', 'XAUUSD', 'long', 'London', '2026-11-04 08:05:00', '2026-11-04 12:40:00', 2722.80000000, 2746.10000000, 0.40000000, 640.00, 2.4000, 'closed'),
  (13, 1, 2, 'T-1054', 'EURJPY', 'short', 'Asia', '2026-11-05 01:20:00', '2026-11-05 03:05:00', 176.85000000, 177.12000000, 0.60000000, -110.00, -0.5000, 'closed'),
  (14, 1, 3, 'T-1055', 'US30', 'short', 'New York', '2026-11-06 15:10:00', '2026-11-06 17:25:00', 47680.00000000, 47490.00000000, 0.40000000, 390.00, 1.6000, 'closed'),
  (15, 1, 1, 'T-1056', 'EURUSD', 'long', 'London', '2026-11-09 08:18:00', '2026-11-09 10:02:00', 1.09480000, 1.09610000, 0.80000000, 120.00, 0.6000, 'closed'),
  (16, 1, 2, 'T-1057', 'GBPUSD', 'short', 'London', '2026-11-10 09:40:00', '2026-11-10 11:15:00', 1.32220000, 1.32510000, 1.00000000, -260.00, -0.9000, 'closed'),
  (17, 1, 3, 'T-1058', 'NAS100', 'long', 'New York', '2026-11-11 15:22:00', '2026-11-11 18:10:00', 20480.00000000, 20615.00000000, 0.60000000, 455.00, 1.9000, 'closed'),
  (18, 1, 1, 'T-1059', 'XAUUSD', 'short', 'London', '2026-11-12 08:11:00', '2026-11-12 11:48:00', 2754.20000000, 2744.60000000, 0.25000000, 210.00, 0.9000, 'closed'),
  (19, 1, 2, 'T-1060', 'EURUSD', 'long', 'London', '2026-11-13 08:06:00', '2026-11-13 09:22:00', 1.09720000, 1.09640000, 1.00000000, -75.00, -0.4000, 'closed'),
  (20, 1, 3, 'T-1061', 'US30', 'long', 'New York', '2026-11-13 15:10:00', NULL, 47842.50000000, NULL, 0.40000000, 85.00, NULL, 'open');
