<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class SetExistingUserPassword extends Command
{
    protected $signature = 'edgeledger:user-set-password';

    protected $description = 'Set a password for an existing EdgeLedger user in the isolated test database';

    public function handle(): int
    {
        if (
            ! defined('PHPUNIT_COMPOSER_INSTALL')
            || ! app()->environment('testing')
            || config('database.connections.'.config('database.default').'.database') !== 'edgeledger_test'
        ) {
            $this->error('This command is allowed only from automated tests using DB_DATABASE=edgeledger_test.');

            return self::FAILURE;
        }

        if (DB::connection()->getDatabaseName() !== 'edgeledger_test') {
            $this->error('The active database is not the authorized test database.');

            return self::FAILURE;
        }

        $email = trim((string) $this->ask('Email for the existing user'));

        if ($email === '') {
            $this->error('An existing user email is required.');

            return self::FAILURE;
        }

        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            $this->error('No matching existing user was found.');

            return self::FAILURE;
        }

        $password = $this->secret('New password (at least 12 characters)');
        $confirmation = $this->secret('Confirm new password');

        if (
            ! is_string($password)
            || mb_strlen($password) < 12
            || ! is_string($confirmation)
            || ! hash_equals($password, $confirmation)
        ) {
            $this->error('The password confirmation was invalid or the password was too short.');

            return self::FAILURE;
        }

        $user->forceFill(['password_hash' => Hash::make($password)])->save();

        $this->info('Password saved for the existing user.');

        return self::SUCCESS;
    }
}
