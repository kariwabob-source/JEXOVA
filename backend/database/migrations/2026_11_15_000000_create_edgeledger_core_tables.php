<?php

use App\Support\EdgeLedgerCoreSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLES = ['users', 'accounts', 'strategies', 'trades'];

    public function up(): void
    {
        $existingTables = array_filter(
            self::TABLES,
            static fn (string $table): bool => Schema::hasTable($table),
        );

        if (count($existingTables) === count(self::TABLES)) {
            EdgeLedgerCoreSchema::assertMatches();

            return;
        }

        if ($existingTables !== []) {
            throw new RuntimeException(
                'Cannot create or baseline EdgeLedger core schema: only some core tables exist. No baseline was recorded.',
            );
        }

        self::createCoreTables();
        EdgeLedgerCoreSchema::assertMatches();
    }

    public function down(): void
    {
        throw new RuntimeException(
            'The EdgeLedger core-schema migration is intentionally irreversible. Preserve business tables and data.',
        );
    }

    private static function createCoreTables(): void
    {
        Schema::create('users', static function (Blueprint $table): void {
            self::setTableOptions($table);
            $table->id();
            $table->string('name', 120);
            $table->string('email', 255)->nullable();
            $table->string('password_hash', 255)->nullable();
            self::timestamps($table);
            $table->unique('email', 'uq_users_email');
        });

        Schema::create('accounts', static function (Blueprint $table): void {
            self::setTableOptions($table);
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('name', 120);
            $table->string('platform', 80);
            $table->char('currency', 3)->default('USD');
            $table->decimal('starting_balance', 15, 2)->default(0);
            self::timestamps($table);
            $table->index('user_id', 'ix_accounts_user_id');
            $table->foreign('user_id', 'fk_accounts_user')
                ->references('id')
                ->on('users')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });

        Schema::create('strategies', static function (Blueprint $table): void {
            self::setTableOptions($table);
            $table->id();
            $table->unsignedBigInteger('account_id');
            $table->string('name', 120);
            $table->text('notes')->nullable();
            self::timestamps($table);
            $table->unique(['account_id', 'name'], 'uq_strategies_account_name');
            $table->foreign('account_id', 'fk_strategies_account')
                ->references('id')
                ->on('accounts')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });

        Schema::create('trades', static function (Blueprint $table): void {
            self::setTableOptions($table);
            $table->id();
            $table->unsignedBigInteger('account_id');
            $table->unsignedBigInteger('strategy_id')->nullable();
            $table->string('external_id', 80);
            $table->string('symbol', 32);
            $table->enum('side', ['long', 'short']);
            $table->string('trading_session', 40);
            $table->dateTime('opened_at');
            $table->dateTime('closed_at')->nullable();
            $table->decimal('entry_price', 18, 8);
            $table->decimal('exit_price', 18, 8)->nullable();
            $table->decimal('quantity', 18, 8);
            $table->decimal('pnl', 15, 2)->default(0);
            $table->decimal('r_multiple', 10, 4)->nullable();
            $table->enum('status', ['open', 'closed'])->default('closed');
            self::timestamps($table);
            $table->unique(['account_id', 'external_id'], 'uq_trades_account_external_id');
            $table->index(['account_id', 'closed_at'], 'ix_trades_account_closed_at');
            $table->index(['account_id', 'status'], 'ix_trades_account_status');
            $table->index('strategy_id', 'ix_trades_strategy_id');
            $table->foreign('account_id', 'fk_trades_account')
                ->references('id')
                ->on('accounts')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
            $table->foreign('strategy_id', 'fk_trades_strategy')
                ->references('id')
                ->on('strategies')
                ->cascadeOnUpdate()
                ->nullOnDelete();
        });
    }

    private static function setTableOptions(Blueprint $table): void
    {
        $table->engine = 'InnoDB';
        $table->charset = 'utf8mb4';
        $table->collation = 'utf8mb4_unicode_ci';
    }

    private static function timestamps(Blueprint $table): void
    {
        $table->timestamp('created_at')->useCurrent();
        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
    }
};
