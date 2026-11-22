<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('trades', 'notes')) {
            return;
        }

        Schema::table('trades', static function (Blueprint $table): void {
            $table->text('notes')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        throw new RuntimeException('This migration is intentionally irreversible to preserve trade notes.');
    }
};
