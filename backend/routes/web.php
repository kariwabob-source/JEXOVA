<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\AccountController;
use App\Http\Controllers\Mt5ConnectionController;
use App\Http\Controllers\StrategyController;
use App\Http\Controllers\TradeController;
use App\Http\Middleware\EnsureRegisteredEmailIsVerified;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function (): void {
    Route::get('/login', [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('/login', [AuthenticatedSessionController::class, 'store'])->middleware('throttle:login');
    Route::get('/register', [AuthenticatedSessionController::class, 'create'])->name('register');
    Route::post('/register', [RegisteredUserController::class, 'store'])->middleware('throttle:reg');
    Route::get('/forgot-password', [PasswordResetLinkController::class, 'create'])->name('password.request');
    Route::post('/forgot-password', [PasswordResetLinkController::class, 'store'])
        ->middleware('throttle:password-reset')
        ->name('password.email');
    Route::get('/reset-password/{token}', [NewPasswordController::class, 'create'])->name('password.reset');
    Route::post('/reset-password', [NewPasswordController::class, 'store'])
        ->middleware('throttle:password-reset')
        ->name('password.update');
});

Route::middleware('auth')->group(function (): void {
    Route::view('/email/verify', 'edgeledger')->name('verification.notice');
    Route::get('/email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
        ->middleware(['signed', 'throttle:6,1'])
        ->name('verification.verify');
    Route::post('/email/verification-notification', [EmailVerificationController::class, 'resend'])
        ->middleware('throttle:6,1')
        ->name('verification.send');
    Route::post('/email/update', [EmailVerificationController::class, 'updateEmail'])
        ->middleware('throttle:6,1')
        ->name('verification.email.update');
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->name('logout');
});

Route::middleware(['auth', EnsureRegisteredEmailIsVerified::class])->group(function (): void {
    Route::view('/', 'edgeledger')->name('dashboard');
    Route::get('/mt5/connections', [Mt5ConnectionController::class, 'index']);
    Route::post('/mt5/pairings', [Mt5ConnectionController::class, 'createPairing'])->middleware('throttle:6,1');
    Route::post('/mt5/connections/{connection}/confirm', [Mt5ConnectionController::class, 'confirm'])
        ->whereNumber('connection')
        ->middleware('throttle:6,1');
    Route::post('/mt5/connections/{connection}/sync', [Mt5ConnectionController::class, 'requestSync'])
        ->whereNumber('connection')
        ->middleware('throttle:10,1');
    Route::post('/mt5/connections/{connection}/revoke', [Mt5ConnectionController::class, 'revoke'])
        ->whereNumber('connection')
        ->middleware('throttle:6,1');
    Route::get('/mt5/connections/{connection}/syncs', [Mt5ConnectionController::class, 'syncHistory'])
        ->whereNumber('connection');
    Route::get('/trade-options', [TradeController::class, 'options']);
    Route::post('/accounts', [AccountController::class, 'store']);
    Route::post('/strategies', [StrategyController::class, 'store']);
    Route::put('/strategies/{strategy}', [StrategyController::class, 'update']);
    Route::delete('/strategies/{strategy}', [StrategyController::class, 'destroy']);
    Route::get('/trade-summary', [TradeController::class, 'summary']);
    Route::get('/trades', [TradeController::class, 'index']);
    Route::get('/trades/{trade}/attachments/{kind}', [TradeController::class, 'showAttachment'])
        ->whereNumber('trade')
        ->where('kind', 'before|after');
    Route::put('/trades/{trade}/notes', [TradeController::class, 'updateNotes']);
    Route::delete('/trades/{trade}/notes', [TradeController::class, 'destroyNotes']);
    Route::get('/trades/{trade}', [TradeController::class, 'show']);
    Route::post('/trades', [TradeController::class, 'store']);
    Route::put('/trades/{trade}', [TradeController::class, 'update']);
    Route::delete('/trades/{trade}', [TradeController::class, 'destroy']);
});
