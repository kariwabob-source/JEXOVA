<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('trades', 'market_condition')) {
            Schema::table('trades', static function (Blueprint $table): void {
                $table->string('market_condition', 20)->nullable()->after('trading_session');
            });
        }

        if (! Schema::hasColumn('trades', 'trend_direction')) {
            Schema::table('trades', static function (Blueprint $table): void {
                $table->string('trend_direction', 20)->nullable()->after('market_condition');
            });
        }
    }

    public function down(): void
    {
        throw new RuntimeException(
            'This migration is intentionally irreversible to preserve structured trade history.',
        );
    }
};
