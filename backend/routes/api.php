<?php

use App\Http\Controllers\Mt5ConnectorController;
use App\Http\Middleware\AuthenticateMt5Connector;
use Illuminate\Support\Facades\Route;

Route::post('/mt5/pair', [Mt5ConnectorController::class, 'pair'])
    ->middleware('throttle:6,1');

Route::middleware(AuthenticateMt5Connector::class)->prefix('mt5/connector')->group(function (): void {
    Route::post('/status', [Mt5ConnectorController::class, 'status'])->middleware('throttle:30,1');
    Route::get('/jobs/next', [Mt5ConnectorController::class, 'nextJob'])->middleware('throttle:60,1');
    Route::post('/jobs/{run}/complete', [Mt5ConnectorController::class, 'complete'])
        ->whereNumber('run')
        ->middleware('throttle:6,1');
    Route::post('/jobs/{run}/fail', [Mt5ConnectorController::class, 'fail'])
        ->whereNumber('run')
        ->middleware('throttle:12,1');
});
