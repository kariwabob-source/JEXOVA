<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use RuntimeException;

final class EdgeLedgerCoreSchema
{
    private const TABLES = ['users', 'accounts', 'strategies', 'trades'];

    public static function assertMatches(): void
    {
        $differences = [];

        $tables = DB::select(
            'SELECT table_name, engine, table_collation
             FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_type = ?',
            ['BASE TABLE'],
        );

        $actualTables = [];

        foreach ($tables as $table) {
            if (in_array($table->table_name, self::TABLES, true)) {
                $actualTables[$table->table_name] = [
                    'engine' => strtolower((string) $table->engine),
                    'collation' => strtolower((string) $table->table_collation),
                ];
            }
        }

        $expectedTables = array_fill_keys(self::TABLES, [
            'engine' => 'innodb',
            'collation' => 'utf8mb4_unicode_ci',
        ]);
        ksort($actualTables);
        ksort($expectedTables);

        if ($actualTables !== $expectedTables) {
            $differences[] = 'table engines/collations or table inventory';
        }

        $actualColumns = [];

        foreach (DB::select(
            'SELECT table_name, column_name, column_type, is_nullable, column_default, extra,
                    COALESCE(collation_name, \'\') AS collation_name
             FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name IN (?, ?, ?, ?)
             ORDER BY table_name, ordinal_position',
            self::TABLES,
        ) as $column) {
            $actualColumns[$column->table_name][] = [
                $column->column_name,
                strtolower((string) $column->column_type),
                $column->is_nullable,
                self::normalizeDefault($column->column_default),
                strtolower(trim((string) $column->extra)),
                strtolower((string) $column->collation_name),
            ];
        }

        $expectedColumns = self::expectedColumns();
        ksort($actualColumns);
        ksort($expectedColumns);

        if ($actualColumns !== $expectedColumns) {
            $differences[] = 'column names, order, types, nullability, defaults, or attributes';
        }

        $actualIndexes = [];

        foreach (DB::select(
            'SELECT table_name, index_name, non_unique, seq_in_index, column_name, sub_part
             FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name IN (?, ?, ?, ?)
             ORDER BY table_name, index_name, seq_in_index',
            self::TABLES,
        ) as $index) {
            $actualIndexes[$index->table_name][] = [
                $index->index_name,
                (int) $index->non_unique,
                (int) $index->seq_in_index,
                $index->column_name,
                $index->sub_part === null ? null : (int) $index->sub_part,
            ];
        }

        $expectedIndexes = self::expectedIndexes();
        ksort($actualIndexes);
        ksort($expectedIndexes);

        if ($actualIndexes !== $expectedIndexes) {
            $differences[] = 'primary keys, indexes, or unique constraints';
        }

        $actualForeignKeys = [];

        foreach (DB::select(
            'SELECT k.table_name, k.constraint_name, k.column_name,
                    k.referenced_table_name, k.referenced_column_name,
                    r.update_rule, r.delete_rule
             FROM information_schema.key_column_usage AS k
             INNER JOIN information_schema.referential_constraints AS r
               ON r.constraint_schema = k.constraint_schema
              AND r.constraint_name = k.constraint_name
              AND r.table_name = k.table_name
             WHERE k.table_schema = DATABASE()
               AND k.table_name IN (?, ?, ?, ?)
               AND k.referenced_table_name IS NOT NULL
             ORDER BY k.table_name, k.constraint_name, k.ordinal_position',
            self::TABLES,
        ) as $foreignKey) {
            $actualForeignKeys[$foreignKey->table_name][] = [
                $foreignKey->constraint_name,
                $foreignKey->column_name,
                $foreignKey->referenced_table_name,
                $foreignKey->referenced_column_name,
                strtoupper($foreignKey->update_rule),
                strtoupper($foreignKey->delete_rule),
            ];
        }

        $expectedForeignKeys = self::expectedForeignKeys();
        ksort($actualForeignKeys);
        ksort($expectedForeignKeys);

        if ($actualForeignKeys !== $expectedForeignKeys) {
            $differences[] = 'foreign keys or referential actions';
        }

        if ($differences !== []) {
            throw new RuntimeException(
                'EdgeLedger core schema verification failed: '.implode('; ', $differences).'. No baseline was recorded.',
            );
        }
    }

    private static function expectedColumns(): array
    {
        return [
            'accounts' => [
                ['id', 'bigint(20) unsigned', 'NO', null, 'auto_increment', ''],
                ['user_id', 'bigint(20) unsigned', 'NO', null, '', ''],
                ['name', 'varchar(120)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['account_type', 'varchar(20)', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['broker_name', 'varchar(120)', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['platform', 'varchar(80)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['connection_method', 'varchar(20)', 'NO', "'manual'", '', 'utf8mb4_unicode_ci'],
                ['currency', 'char(3)', 'NO', "'usd'", '', 'utf8mb4_unicode_ci'],
                ['starting_balance', 'decimal(15,2)', 'NO', '0.00', '', ''],
                ['account_reference', 'text', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['nominal_account_size', 'decimal(15,2)', 'YES', null, '', ''],
                ['challenge_phase', 'varchar(32)', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['created_at', 'timestamp', 'NO', 'current_timestamp()', '', ''],
                ['updated_at', 'timestamp', 'NO', 'current_timestamp()', 'on update current_timestamp()', ''],
            ],
            'strategies' => [
                ['id', 'bigint(20) unsigned', 'NO', null, 'auto_increment', ''],
                ['account_id', 'bigint(20) unsigned', 'NO', null, '', ''],
                ['name', 'varchar(120)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['notes', 'text', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['created_at', 'timestamp', 'NO', 'current_timestamp()', '', ''],
                ['updated_at', 'timestamp', 'NO', 'current_timestamp()', 'on update current_timestamp()', ''],
            ],
            'trades' => [
                ['id', 'bigint(20) unsigned', 'NO', null, 'auto_increment', ''],
                ['account_id', 'bigint(20) unsigned', 'NO', null, '', ''],
                ['strategy_id', 'bigint(20) unsigned', 'YES', null, '', ''],
                ['external_id', 'varchar(80)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['symbol', 'varchar(32)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['side', "enum('long','short')", 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['trading_session', 'varchar(40)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['opened_at', 'datetime', 'NO', null, '', ''],
                ['closed_at', 'datetime', 'YES', null, '', ''],
                ['entry_price', 'decimal(18,8)', 'NO', null, '', ''],
                ['exit_price', 'decimal(18,8)', 'YES', null, '', ''],
                ['quantity', 'decimal(18,8)', 'NO', null, '', ''],
                ['pnl', 'decimal(15,2)', 'NO', '0.00', '', ''],
                ['r_multiple', 'decimal(10,4)', 'YES', null, '', ''],
                ['status', "enum('open','closed')", 'NO', "'closed'", '', 'utf8mb4_unicode_ci'],
                ['created_at', 'timestamp', 'NO', 'current_timestamp()', '', ''],
                ['updated_at', 'timestamp', 'NO', 'current_timestamp()', 'on update current_timestamp()', ''],
            ],
            'users' => [
                ['id', 'bigint(20) unsigned', 'NO', null, 'auto_increment', ''],
                ['name', 'varchar(120)', 'NO', null, '', 'utf8mb4_unicode_ci'],
                ['email', 'varchar(255)', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['password_hash', 'varchar(255)', 'YES', null, '', 'utf8mb4_unicode_ci'],
                ['created_at', 'timestamp', 'NO', 'current_timestamp()', '', ''],
                ['updated_at', 'timestamp', 'NO', 'current_timestamp()', 'on update current_timestamp()', ''],
            ],
        ];
    }

    private static function expectedIndexes(): array
    {
        return [
            'accounts' => [
                ['ix_accounts_user_id', 1, 1, 'user_id', null],
                ['PRIMARY', 0, 1, 'id', null],
            ],
            'strategies' => [
                ['PRIMARY', 0, 1, 'id', null],
                ['uq_strategies_account_name', 0, 1, 'account_id', null],
                ['uq_strategies_account_name', 0, 2, 'name', null],
            ],
            'trades' => [
                ['ix_trades_account_closed_at', 1, 1, 'account_id', null],
                ['ix_trades_account_closed_at', 1, 2, 'closed_at', null],
                ['ix_trades_account_status', 1, 1, 'account_id', null],
                ['ix_trades_account_status', 1, 2, 'status', null],
                ['ix_trades_strategy_id', 1, 1, 'strategy_id', null],
                ['PRIMARY', 0, 1, 'id', null],
                ['uq_trades_account_external_id', 0, 1, 'account_id', null],
                ['uq_trades_account_external_id', 0, 2, 'external_id', null],
            ],
            'users' => [
                ['PRIMARY', 0, 1, 'id', null],
                ['uq_users_email', 0, 1, 'email', null],
            ],
        ];
    }

    private static function expectedForeignKeys(): array
    {
        return [
            'accounts' => [
                ['fk_accounts_user', 'user_id', 'users', 'id', 'CASCADE', 'CASCADE'],
            ],
            'strategies' => [
                ['fk_strategies_account', 'account_id', 'accounts', 'id', 'CASCADE', 'CASCADE'],
            ],
            'trades' => [
                ['fk_trades_account', 'account_id', 'accounts', 'id', 'CASCADE', 'CASCADE'],
                ['fk_trades_strategy', 'strategy_id', 'strategies', 'id', 'CASCADE', 'SET NULL'],
            ],
        ];
    }

    private static function normalizeDefault(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $normalized = strtolower(trim((string) $value));

        if ($normalized === 'null') {
            return null;
        }

        return preg_replace('/^current_timestamp(?:\\(\\))?$/', 'current_timestamp()', $normalized);
    }
}
