<?php

require dirname(__DIR__) . '/vendor/autoload.php';

$app = require dirname(__DIR__) . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$connection = Illuminate\Support\Facades\DB::connection();
$table = 'edgeledger_connection_probe';

$connection->statement(
    "CREATE TEMPORARY TABLE {$table} (id INT NOT NULL)"
);

try {
    $connection->beginTransaction();
    $connection->insert("INSERT INTO {$table} (id) VALUES (?)", [1]);
    $insideTransaction = $connection->table($table)->count();
    $connection->rollBack();

    $afterRollback = $connection->table($table)->count();

    if ($insideTransaction !== 1 || $afterRollback !== 0) {
        throw new RuntimeException('The temporary insert did not roll back as expected.');
    }

    printf("Temporary row count in transaction: %d\n", $insideTransaction);
    printf("Temporary row count after rollback: %d\n", $afterRollback);
    echo "Rollback test passed; no permanent business records were written.\n";
} catch (Throwable $exception) {
    if ($connection->transactionLevel() > 0) {
        $connection->rollBack();
    }

    throw $exception;
} finally {
    $connection->statement("DROP TEMPORARY TABLE IF EXISTS {$table}");
}
