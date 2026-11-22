<p align="center"><a href="https://laravel.com" target="_blank"><img src="https://raw.githubusercontent.com/laravel/art/master/logo-lockup/5%20SVG/2%20CMYK/1%20Full%20Color/laravel-logolockup-cmyk-red.svg" width="400" alt="Laravel Logo"></a></p>

<p align="center">
<a href="https://github.com/laravel/framework/actions"><img src="https://github.com/laravel/framework/workflows/tests/badge.svg" alt="Build Status"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/dt/laravel/framework" alt="Total Downloads"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/v/laravel/framework" alt="Latest Stable Version"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/l/laravel/framework" alt="License"></a>
</p>

## About Laravel

Laravel is a web application framework with expressive, elegant syntax. We believe development must be an enjoyable and creative experience to be truly fulfilling. Laravel takes the pain out of development by easing common tasks used in many web projects, such as:

- [Simple, fast routing engine](https://laravel.com/docs/routing).
- [Powerful dependency injection container](https://laravel.com/docs/container).
- Multiple back-ends for [session](https://laravel.com/docs/session) and [cache](https://laravel.com/docs/cache) storage.
- Expressive, intuitive [database ORM](https://laravel.com/docs/eloquent).
- Database agnostic [schema migrations](https://laravel.com/docs/migrations).
- [Robust background job processing](https://laravel.com/docs/queues).
- [Real-time event broadcasting](https://laravel.com/docs/broadcasting).

Laravel is accessible, powerful, and provides tools required for large, robust applications.

## JEXOVA local development

The authoritative application database is the MySQL database `edgeledger` in local development and production. Normal web requests fail closed unless they use that database. Automated tests alone use `edgeledger_test`, forced by `phpunit.xml` and checked against the active connection by the test base class. Test requests cannot be served as normal application requests.

From PowerShell, start the application with:

```powershell
Set-Location 'C:\Users\USER\edgeledger\backend'
.\start-edgeledger-dev.ps1
```

For frontend development, run `npm run dev` from `frontend`. Its Vite proxy forwards application pages, auth forms, JSON requests, and built assets to the single Laravel backend on port `8000`; Laravel remains responsible for sessions, CSRF, registration, login, and persistence. Use the Vite URL it prints (it may choose `5174` when `5173` is occupied). Do not start a second Laravel server with `php artisan serve`; it can select another port and create a separate backend instance.

### One-click Windows development

From File Explorer, double-click `Start-JEXOVA.bat` in the project root. It checks port `3306` for XAMPP MySQL, starts the matching XAMPP instance only if MySQL is stopped and the `edgeledger` data directory identifies one unambiguous installation, verifies Laravel's effective local database, starts or reuses Laravel on `127.0.0.1:8000` and Vite on `127.0.0.1:5173`, waits for the proxied login page and its CSRF token, then opens `http://localhost:5173/login`. If an expected port belongs to another application, it reports the conflict instead of stopping that process or choosing another port.

Double-click `Stop-JEXOVA.bat` to stop only Laravel and Vite processes recorded as started by this launcher. It verifies each PID, executable, project command line, and process start time before stopping it. Servers that were already running before the launcher are reused but are not claimed or stopped. MySQL is never recorded or stopped.

The one-click scripts do not edit `.env`, Laravel's configuration cache, application configuration, databases, or records. MySQL remains running after shutdown.

To create a desktop shortcut, right-click `Start-JEXOVA.bat` in File Explorer and choose **Show more options > Send to > Desktop (create shortcut)**. Double-click the desktop shortcut to start JEXOVA. Keep `Stop-JEXOVA.bat` nearby for a safe shutdown.

For deployment, set `APP_ENV=production`, `DB_CONNECTION=mysql`, and `DB_DATABASE=edgeledger` in the deployment environment, and supply the host and credentials there. Never copy a local `.env` or configure the production application to use `edgeledger_test`.

The script checks MySQL, clears a stale Laravel configuration cache only when present, verifies the effective database without displaying credentials, and starts Laravel at `http://127.0.0.1:8000`. It does not stop existing processes. Close any old Laravel servers first, especially a test server on port `8001`. To check the local configuration manually, run `php artisan edgeledger:database-status`.

## Learning Laravel

Laravel has the most extensive and thorough [documentation](https://laravel.com/docs) and video tutorial library of all modern web application frameworks, making it a breeze to get started with the framework.

In addition, [Laracasts](https://laracasts.com) contains thousands of video tutorials on a range of topics including Laravel, modern PHP, unit testing, and JavaScript. Boost your skills by digging into our comprehensive video library.

You can also watch bite-sized lessons with real-world projects on [Laravel Learn](https://laravel.com/learn), where you will be guided through building a Laravel application from scratch while learning PHP fundamentals.

## Agentic Development

Laravel's predictable structure and conventions make it ideal for AI coding agents like Claude Code, Cursor, and GitHub Copilot. Install [Laravel Boost](https://laravel.com/docs/ai) to supercharge your AI workflow:

```bash
composer require laravel/boost --dev

php artisan boost:install
```

Boost provides your agent 15+ tools and skills that help agents build Laravel applications while following best practices.

## Contributing

Thank you for considering contributing to the Laravel framework! The contribution guide can be found in the [Laravel documentation](https://laravel.com/docs/contributions).

## Code of Conduct

In order to ensure that the Laravel community is welcoming to all, please review and abide by the [Code of Conduct](https://laravel.com/docs/contributions#code-of-conduct).

## Security Vulnerabilities

If you discover a security vulnerability within Laravel, please send an e-mail to Taylor Otwell via [taylor@laravel.com](mailto:taylor@laravel.com). All security vulnerabilities will be promptly addressed.

## License

The Laravel framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
