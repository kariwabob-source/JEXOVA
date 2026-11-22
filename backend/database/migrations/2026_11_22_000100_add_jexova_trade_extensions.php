<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trades', function (Blueprint $table): void {
            if (! Schema::hasColumn('trades', 'contract_size')) {
                $table->decimal('contract_size', 18, 8)->default(1)->after('quantity');
            }
            if (! Schema::hasColumn('trades', 'commission')) {
                $table->decimal('commission', 15, 2)->default(0)->after('contract_size');
            }
            if (! Schema::hasColumn('trades', 'swap')) {
                $table->decimal('swap', 15, 2)->default(0)->after('commission');
            }
            if (! Schema::hasColumn('trades', 'gross_pnl')) {
                $table->decimal('gross_pnl', 15, 2)->nullable()->after('swap');
            }
            if (! Schema::hasColumn('trades', 'risk_amount')) {
                $table->decimal('risk_amount', 15, 2)->nullable()->after('gross_pnl');
            }
            if (! Schema::hasColumn('trades', 'risk_percentage')) {
                $table->decimal('risk_percentage', 8, 4)->nullable()->after('risk_amount');
            }
            if (! Schema::hasColumn('trades', 'stop_loss')) {
                $table->decimal('stop_loss', 18, 8)->nullable()->after('risk_percentage');
            }
            if (! Schema::hasColumn('trades', 'take_profit')) {
                $table->decimal('take_profit', 18, 8)->nullable()->after('stop_loss');
            }
            if (! Schema::hasColumn('trades', 'timeframe')) {
                $table->string('timeframe', 32)->nullable()->after('take_profit');
            }
            if (! Schema::hasColumn('trades', 'setup')) {
                $table->string('setup', 120)->nullable()->after('timeframe');
            }
            if (! Schema::hasColumn('trades', 'trade_source')) {
                $table->string('trade_source', 20)->default('manual')->after('setup');
            }
            if (! Schema::hasColumn('trades', 'lessons_learned')) {
                $table->text('lessons_learned')->nullable()->after('trade_source');
            }
            if (! Schema::hasColumn('trades', 'emotional_state')) {
                $table->string('emotional_state', 40)->nullable()->after('lessons_learned');
            }
        });
    }

    public function down(): void
    {
        throw new RuntimeException('This migration is intentionally irreversible to preserve trade history.');
    }
};
