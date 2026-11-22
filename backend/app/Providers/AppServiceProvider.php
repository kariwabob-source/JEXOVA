<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use RuntimeException;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->assertApplicationDatabaseConfiguration();

        RateLimiter::for('login', static function (Request $request): Limit {
            $identity = mb_strtolower(trim((string) $request->input('email')));
            $key = hash('sha256', $identity.'|'.$request->ip());

            return Limit::perMinute(5)->by($key);
        });

        RateLimiter::for('reg', static function (Request $request): Limit {
            return Limit::perMinute(5)->by(hash('sha256', (string) $request->ip()));
        });

        RateLimiter::for('password-reset', static function (Request $request): Limit {
            return Limit::perMinute(5)->by(hash('sha256', (string) $request->ip()));
        });
    }

    private function assertApplicationDatabaseConfiguration(): void
    {
        if (in_array(PHP_SAPI, ['cli', 'phpdbg'], true)) {
            return;
        }

        $environment = app()->environment();
        $connectionName = config('database.default');
        $connection = config("database.connections.{$connectionName}", []);
        $url = $connection['url'] ?? null;
        $urlDatabase = is_string($url) && $url !== ''
            ? ltrim((string) parse_url($url, PHP_URL_PATH), '/')
            : null;

        if ($environment === 'testing') {
            throw new RuntimeException('The PHPUnit testing environment cannot serve normal application requests.');
        }

        if (
            $connectionName !== 'mysql'
            || ($urlDatabase ?? ($connection['database'] ?? null)) !== 'edgeledger'
            || ($environment === 'local' && ! empty($url))
        ) {
            throw new RuntimeException(
                'Normal EdgeLedger requests require the mysql edgeledger database; edgeledger_test is reserved for automated tests.',
            );
        }
    }
}
