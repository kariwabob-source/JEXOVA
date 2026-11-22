# JEXOVA backend setup

The Laravel backend is separate from the React frontend and targets MariaDB/MySQL. The default cache, queue, and session drivers use files, synchronous jobs, and files respectively; database-backed drivers are not enabled unless explicitly configured.

## Migration safety

Composer setup hooks do not run migrations. Do not run migration commands until the database connection has been explicitly checked and points to the intended database.

The default migration set contains one JEXOVA core-schema migration for `users`, `accounts`, `strategies`, and `trades`. It supports both:

- **Fresh databases:** creates the four core tables with the canonical JEXOVA definitions.
- **Existing JEXOVA databases:** verifies the complete table, column, index, unique-key, and foreign-key definitions. It returns without issuing table-creation statements only when all four tables match exactly. Laravel records that migration only after the verification succeeds.

If any core tables are missing from an otherwise existing schema, or if any definition differs, the migration stops and does not record itself. The migration repository table may be created by Laravel before the core migration runs; no business tables or records are changed by the verification branch.

The core migration is intentionally irreversible. Do not use `migrate:rollback`, `migrate:refresh`, or `migrate:fresh` against an JEXOVA database.

## Existing database procedure

1. Make and verify a restorable backup.
2. Set Laravel's environment variables to the intended database and confirm the database name before migration.
3. Test first against an isolated copy. The core migration compares the existing schema, then Laravel records the baseline only after the migration returns successfully.
4. Inspect migration status and verify table counts and data after the test.
5. Do not point the command at production without separate approval.

The repository does not automatically mark migrations as applied. The schema check is the gate that allows Laravel's normal migration runner to record the core baseline.

## Fresh database procedure

Create and select a new, empty MariaDB/MySQL database outside of Composer setup, then run:

```powershell
php artisan migrate
```

This runs the core migration from the standard migration directory. It does not create cache, queue, session, authentication, or password-reset tables.

## Optional database cache and queue tables

The cache and job migrations are kept under `database/migrations/optional` and are excluded from the standard migration scan. They can be run explicitly when the corresponding database-backed drivers are deliberately selected and the target database is confirmed:

```powershell
php artisan migrate --path=database/migrations/optional
```

That optional path creates Laravel's `cache`, `cache_locks`, `jobs`, `job_batches`, and `failed_jobs` tables. Database-backed sessions are not enabled by default and do not have a migration in this project yet.

## Local runtime

This scaffold uses Laravel 13 and PHP 8.3. PHP 8.3 was installed side-by-side with XAMPP's PHP runtime. The PHP executable and its local configuration are under the current Windows user's Local AppData directory. Composer is installed there as `JEXOVA\tools\composer.phar`.

From PowerShell in this directory, run the verification script with the side-by-side PHP runtime:

```powershell
$env:PHPRC = "$env:LOCALAPPDATA\JEXOVA\tools"
$php = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.3*\php.exe" |
  Select-Object -First 1 -ExpandProperty FullName
& $php scripts\check-database.php
```

To run the normal application locally, use the guarded development launcher rather than starting an additional Laravel server:

```powershell
.\start-jexova-dev.ps1
```

The launcher verifies the `jexova` database and starts Laravel on port `8000`. Start the frontend separately with `npm run dev` from `frontend`; its Vite proxy forwards application requests to that one backend. Do not use a second `php artisan serve` process for normal requests. The generated Laravel `.env` is local-only and ignored by Git. Do not commit it. Create a least-privilege database account before exposing the application beyond local development.

Laravel's generic `db:show` command queries `performance_schema.session_status`, which is unavailable in this MariaDB 10.4 environment. Use `scripts/check-database.php` for the connection smoke test.

The Laravel-rendered React frontend uses Laravel's session-authenticated web routes and JSON endpoints. Vite forwards those application routes to the canonical local backend; production requests run directly through the deployed Laravel application.
