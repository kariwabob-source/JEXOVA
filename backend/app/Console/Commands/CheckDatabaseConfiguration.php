<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckDatabaseConfiguration extends Command
{
    protected $signature = 'edgeledger:database-status';

    protected $description = 'Verify the local EdgeLedger database connection without displaying credentials';

    public function handle(): int
    {
        $connectionName = config('database.default');
        $connection = config("database.connections.{$connectionName}", []);

        if (
            ! app()->environment('local')
            || $connectionName !== 'mysql'
            || ($connection['database'] ?? null) !== 'edgeledger'
            || ! empty($connection['url'])
        ) {
            $this->error(
                'Expected APP_ENV=local, DB_CONNECTION=mysql, DB_DATABASE=edgeledger, and an empty DB_URL in backend\\.env.',
            );

            return self::FAILURE;
        }

        $activeDatabase = DB::connection()->getDatabaseName();

        if ($activeDatabase !== 'edgeledger') {
            $this->error('The active MySQL database is not edgeledger. No application server was started.');

            return self::FAILURE;
        }

        $this->info('Environment: local');
        $this->info('Connection: mysql');
        $this->info('Database: edgeledger');
        $this->info('Status: reachable');

        return self::SUCCESS;
    }
}
