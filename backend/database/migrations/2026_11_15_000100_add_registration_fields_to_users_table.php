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

        if (! Schema::hasTable('users')) {
            throw new RuntimeException('Cannot add registration fields because the users table is missing.');
        }

        $hasUniqueEmail = false;

        foreach (Schema::getIndexes('users') as $index) {
            if ($index['unique'] && $index['columns'] === ['email']) {
                $hasUniqueEmail = true;
                break;
            }
        }

        if (! $hasUniqueEmail) {
            throw new RuntimeException('Cannot add registration fields without the existing unique email index.');
        }

        $columns = [
            'first_name',
            'last_name',
            'username',
            'country',
            'phone_number',
            'terms_accepted_at',
            'privacy_accepted_at',
            'email_verified_at',
        ];

        foreach ($columns as $column) {
            if (Schema::hasColumn('users', $column)) {
                throw new RuntimeException(
                    'Registration schema is partially present. No registration columns were added.',
                );
            }
        }

        Schema::table('users', static function (Blueprint $table): void {
            $table->string('first_name', 120)->nullable()->after('name');
            $table->string('last_name', 120)->nullable()->after('first_name');
            $table->string('username', 60)->nullable()->after('last_name');
            $table->string('country', 100)->nullable()->after('username');
            $table->string('phone_number', 30)->nullable()->after('country');
            $table->timestamp('terms_accepted_at')->nullable()->after('phone_number');
            $table->timestamp('privacy_accepted_at')->nullable()->after('terms_accepted_at');
            $table->timestamp('email_verified_at')->nullable()->after('privacy_accepted_at');
            $table->unique('username', 'uq_users_username');
        });
    }

    public function down(): void
    {
        throw new RuntimeException(
            'The registration schema migration is intentionally irreversible to preserve accepted terms and account data.',
        );
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
                'Registration migration is allowed only on local mysql edgeledger or testing mysql edgeledger_test.',
            );
        }

        $database = DB::connection()->selectOne('SELECT DATABASE() AS database_name')->database_name ?? null;

        if ($database !== $allowedDatabase) {
            throw new RuntimeException('Registration migration stopped because the active database is not authorized.');
        }
    }
};
