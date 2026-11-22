<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (
            ! app()->environment('testing')
            || config('database.default') !== 'mysql'
            || config('database.connections.mysql.database') !== 'edgeledger_test'
            || ! empty(config('database.connections.mysql.url'))
            || DB::connection()->getDatabaseName() !== 'edgeledger_test'
        ) {
            throw new RuntimeException('Automated tests are restricted to the mysql edgeledger_test database.');
        }
    }
}
