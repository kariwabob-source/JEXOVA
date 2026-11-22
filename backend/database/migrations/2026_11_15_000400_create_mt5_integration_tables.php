<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mt5_connections', static function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('account_id')->nullable()->unique();
            $table->string('account_name', 120);
            $table->string('token_hash', 64)->nullable()->unique();
            $table->string('status', 20)->default('pending');
            $table->string('account_login', 20)->nullable();
            $table->string('server', 255)->nullable();
            $table->char('currency', 3)->nullable();
            $table->decimal('balance', 20, 8)->nullable();
            $table->decimal('equity', 20, 8)->nullable();
            $table->unsignedInteger('leverage')->nullable();
            $table->boolean('is_demo')->default(false);
            $table->timestamp('last_sync_at')->nullable();
            $table->string('last_error_code', 80)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status'], 'ix_mt5_connections_user_status');
            $table->foreign('user_id', 'fk_mt5_connections_user')
                ->references('id')
                ->on('users')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
            $table->foreign('account_id', 'fk_mt5_connections_account')
                ->references('id')
                ->on('accounts')
                ->cascadeOnUpdate()
                ->nullOnDelete();
        });

        Schema::create('mt5_pairings', static function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('connection_id');
            $table->string('code_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();

            $table->foreign('connection_id', 'fk_mt5_pairings_connection')
                ->references('id')
                ->on('mt5_connections')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });

        Schema::create('mt5_sync_runs', static function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('connection_id');
            $table->unsignedBigInteger('requested_by');
            $table->string('status', 20)->default('queued');
            $table->unsignedInteger('orders_count')->default(0);
            $table->unsignedInteger('deals_count')->default(0);
            $table->unsignedInteger('positions_count')->default(0);
            $table->timestamp('requested_at');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->string('error_code', 80)->nullable();
            $table->timestamps();

            $table->index(['connection_id', 'status', 'id'], 'ix_mt5_sync_runs_connection_status');
            $table->foreign('connection_id', 'fk_mt5_sync_runs_connection')
                ->references('id')
                ->on('mt5_connections')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
            $table->foreign('requested_by', 'fk_mt5_sync_runs_user')
                ->references('id')
                ->on('users')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });

        Schema::create('mt5_imported_orders', static function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('connection_id');
            $table->string('ticket', 20);
            $table->string('position_id', 20)->nullable();
            $table->string('symbol', 32)->nullable();
            $table->string('order_type', 40)->nullable();
            $table->string('state', 40)->nullable();
            $table->decimal('volume_initial', 20, 8)->nullable();
            $table->decimal('volume_current', 20, 8)->nullable();
            $table->decimal('price_open', 20, 8)->nullable();
            $table->decimal('price_current', 20, 8)->nullable();
            $table->dateTime('time_setup')->nullable();
            $table->dateTime('time_done')->nullable();
            $table->json('payload');
            $table->timestamps();

            $table->unique(['connection_id', 'ticket'], 'uq_mt5_orders_source_ticket');
            $table->index(['connection_id', 'position_id'], 'ix_mt5_orders_position');
            $table->foreign('connection_id', 'fk_mt5_orders_connection')
                ->references('id')
                ->on('mt5_connections')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });

        Schema::create('mt5_imported_deals', static function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('connection_id');
            $table->string('ticket', 20);
            $table->string('order_ticket', 20)->nullable();
            $table->string('position_id', 20)->nullable();
            $table->string('symbol', 32)->nullable();
            $table->string('deal_type', 40)->nullable();
            $table->string('entry_type', 40)->nullable();
            $table->decimal('volume', 20, 8)->nullable();
            $table->decimal('price', 20, 8)->nullable();
            $table->decimal('commission', 20, 8)->default(0);
            $table->decimal('swap', 20, 8)->default(0);
            $table->decimal('profit', 20, 8)->default(0);
            $table->decimal('fee', 20, 8)->default(0);
            $table->dateTime('occurred_at')->nullable();
            $table->json('payload');
            $table->timestamps();

            $table->unique(['connection_id', 'ticket'], 'uq_mt5_deals_source_ticket');
            $table->index(['connection_id', 'position_id'], 'ix_mt5_deals_position');
            $table->foreign('connection_id', 'fk_mt5_deals_connection')
                ->references('id')
                ->on('mt5_connections')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });

        Schema::create('mt5_open_positions', static function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('connection_id');
            $table->string('ticket', 20);
            $table->string('position_id', 20)->nullable();
            $table->string('symbol', 32)->nullable();
            $table->string('position_type', 40)->nullable();
            $table->decimal('volume', 20, 8)->nullable();
            $table->decimal('price_open', 20, 8)->nullable();
            $table->decimal('price_current', 20, 8)->nullable();
            $table->decimal('stop_loss', 20, 8)->nullable();
            $table->decimal('take_profit', 20, 8)->nullable();
            $table->decimal('swap', 20, 8)->default(0);
            $table->decimal('profit', 20, 8)->default(0);
            $table->dateTime('opened_at')->nullable();
            $table->boolean('is_open')->default(true);
            $table->timestamp('last_seen_at')->nullable();
            $table->json('payload');
            $table->timestamps();

            $table->unique(['connection_id', 'ticket'], 'uq_mt5_positions_source_ticket');
            $table->index(['connection_id', 'is_open'], 'ix_mt5_positions_open');
            $table->foreign('connection_id', 'fk_mt5_positions_connection')
                ->references('id')
                ->on('mt5_connections')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        throw new RuntimeException(
            'The MT5 integration migration is intentionally irreversible. Preserve imported source records and connection history.',
        );
    }
};
