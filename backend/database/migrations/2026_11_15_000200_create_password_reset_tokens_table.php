<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->assertDevelopmentDatabase();

        Schema::create('password_reset_tokens', static function (Blueprint $table): void {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        $this->assertTestDatabase();

        Schema::dropIfExists('password_reset_tokens');
    }

    private function assertTestDatabase(): void
    {
        $connectionName = config('database.default');
        $connection = config('database.connections.'.$connectionName);

        if (
            $connectionName !== 'mysql'
            || ($connection['database'] ?? null) !== 'edgeledger_test'
            || ! empty($connection['url'])
        ) {
            throw new RuntimeException('Password reset token migration is allowed only on explicit mysql edgeledger_test.');
        }

        $database = DB::connection()->selectOne('SELECT DATABASE() AS database_name')->database_name ?? null;

        if ($database !== 'edgeledger_test') {
            throw new RuntimeException('Password reset token migration stopped because the active database is not edgeledger_test.');
        }
    }

    private function assertDevelopmentDatabase(): void
    {
        $connectionName = config('database.default');
        $connection = config('database.connections.'.$connectionName);
        $applicationEnvironment = app()->environment();
        $allowedDatabase = match ($applicationEnvironment) {
            'local' => 'edgeledger',
            'testing' => 'edgeledger_test',
            default => null,
        };

        if (
            $allowedDatabase === null
            || $connectionName !== 'mysql'
            || ($connection['database'] ?? null) !== $allowedDatabase
            || ! empty($connection['url'])
        ) {
            throw new RuntimeException(
                'Password reset token migration is allowed only on local mysql edgeledger or testing mysql edgeledger_test.',
            );
        }

        $database = DB::connection()->selectOne('SELECT DATABASE() AS database_name')->database_name ?? null;

        if ($database !== $allowedDatabase) {
            throw new RuntimeException('Password reset token migration stopped because the active database is not authorized.');
        }
    }
};
