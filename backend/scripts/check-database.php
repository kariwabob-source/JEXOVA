<?php

require dirname(__DIR__) . '/vendor/autoload.php';

$app = require dirname(__DIR__) . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$connection = Illuminate\Support\Facades\DB::connection();
$server = $connection->selectOne(
    'SELECT DATABASE() AS database_name, VERSION() AS server_version'
);

printf("Connected database: %s\n", $server->database_name);
printf("Database server: %s\n", $server->server_version);
printf("PDO driver: %s\n", $connection->getPdo()->getAttribute(PDO::ATTR_DRIVER_NAME));

$tables = $connection->select(
    'SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ?
     ORDER BY TABLE_NAME',
    ['BASE TABLE']
);

echo "Tables and row counts:\n";
foreach ($tables as $table) {
    $count = $connection->table($table->TABLE_NAME)->count();
    printf("- %s: %d\n", $table->TABLE_NAME, $count);
}
