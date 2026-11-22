<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('accounts', static function (Blueprint $table): void {
            $table->string('account_type', 20)->nullable()->after('name');
            $table->string('broker_name', 120)->nullable()->after('account_type');
            $table->string('connection_method', 20)->default('manual')->after('platform');
            $table->text('account_reference')->nullable()->after('starting_balance');
            $table->decimal('nominal_account_size', 15, 2)->nullable()->after('account_reference');
            $table->string('challenge_phase', 32)->nullable()->after('nominal_account_size');
        });

        foreach (DB::table('mt5_connections')->whereNotNull('account_id')->get(['account_id', 'is_demo', 'server']) as $connection) {
            DB::table('accounts')
                ->where('id', $connection->account_id)
                ->update([
                    'account_type' => $connection->is_demo ? 'demo' : 'real',
                    'broker_name' => $connection->server,
                    'connection_method' => 'mt5',
                ]);
        }
    }

    public function down(): void
    {
        Schema::table('accounts', static function (Blueprint $table): void {
            $table->dropColumn([
                'account_type',
                'broker_name',
                'connection_method',
                'account_reference',
                'nominal_account_size',
                'challenge_phase',
            ]);
        });
    }
};