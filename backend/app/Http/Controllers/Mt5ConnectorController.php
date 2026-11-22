<?php

namespace App\Http\Controllers;

use App\Http\Middleware\AuthenticateMt5Connector;
use App\Models\Mt5Connection;
use App\Models\Mt5Pairing;
use App\Models\Mt5SyncRun;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class Mt5ConnectorController extends Controller
{
    private const ERROR_CODES = [
        'account_mismatch',
        'connector_error',
        'credential_store_unavailable',
        'history_unavailable',
        'invalid_mt5_data',
        'mt5_package_missing',
        'unsupported_account_type',
        'terminal_disconnected',
        'terminal_unavailable',
        'unsupported_platform',
    ];

    public function pair(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pairing_code' => ['required', 'string', 'size:64', 'regex:/\A[a-f0-9]{64}\z/i'],
        ]);
        $connectorToken = bin2hex(random_bytes(32));

        $connection = DB::transaction(function () use ($validated, $connectorToken): Mt5Connection {
            $pairing = Mt5Pairing::query()
                ->where('code_hash', hash('sha256', strtolower($validated['pairing_code'])))
                ->lockForUpdate()
                ->first();

            if ($pairing === null || $pairing->consumed_at !== null || $pairing->expires_at->isPast()) {
                abort(422, 'The pairing code is invalid or expired.');
            }

            $connection = Mt5Connection::query()
                ->whereKey($pairing->connection_id)
                ->lockForUpdate()
                ->firstOrFail();

            abort_if(
                ! $connection->user?->hasVerifiedEmail(),
                403,
                'Verify your email address to continue.',
            );

            if ($connection->token_hash !== null) {
                abort(409, 'This pairing code has already been used.');
            }

            $pairing->consumed_at = now();
            $pairing->save();
            $connection->token_hash = hash('sha256', $connectorToken);
            $connection->status = 'paired';
            $connection->save();

            return $connection;
        });

        return response()->json([
            'data' => [
                'connection_id' => $connection->getKey(),
                'connector_token' => $connectorToken,
            ],
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function status(Request $request): JsonResponse
    {
        /** @var Mt5Connection $connection */
        $connection = $request->attributes->get(AuthenticateMt5Connector::CONNECTION_ATTRIBUTE);
        $validated = $request->validate([
            'status' => ['required', Rule::in(['connected', 'error'])],
            'error_code' => ['required_if:status,error', 'nullable', Rule::in(self::ERROR_CODES)],
            'account' => ['required_if:status,connected', 'array'],
            'account.login' => ['required_if:status,connected', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'account.server' => ['required_if:status,connected', 'string', 'max:255'],
            'account.currency' => ['required_if:status,connected', 'string', 'regex:/\A[A-Z]{3}\z/'],
            'account.balance' => ['required_if:status,connected', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'account.equity' => ['required_if:status,connected', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'account.leverage' => ['required_if:status,connected', 'integer', 'between:1,1000000'],
            'account.trade_mode' => ['required_if:status,connected', 'integer', Rule::in([0, 2])],
        ]);

        if ($validated['status'] === 'error') {
            $connection->status = 'error';
            $connection->last_error_code = $validated['error_code'];
            $connection->save();

            return response()->json(['data' => ['status' => $connection->status]]);
        }

        $accountData = $validated['account'];
        $login = $accountData['login'];
        $server = $accountData['server'];

        if (($connection->account_login !== null && $connection->account_login !== $login)
            || ($connection->server !== null && $connection->server !== $server)
            || ($connection->account_login !== null
                && $connection->is_demo !== ($accountData['trade_mode'] === 0))) {
            $connection->status = 'error';
            $connection->last_error_code = 'account_mismatch';
            $connection->save();

            return response()->json(['message' => 'The active terminal account does not match the paired trading account.'], 409);
        }

        DB::transaction(function () use ($connection, $accountData, $login, $server): void {
            $connection->account_login = $login;
            $connection->server = $server;
            $connection->currency = $accountData['currency'];
            $connection->balance = $accountData['balance'];
            $connection->equity = $accountData['equity'];
            $connection->leverage = $accountData['leverage'];
            $connection->is_demo = $accountData['trade_mode'] === 0;
            $connection->status = $connection->account_id === null ? 'pending_confirmation' : 'connected';
            $connection->last_error_code = null;
            $connection->save();
        });

        return response()->json([
            'data' => [
                'status' => $connection->status,
                'account_type' => $connection->is_demo ? 'demo' : 'live',
            ],
        ]);
    }

    public function nextJob(Request $request): JsonResponse
    {
        /** @var Mt5Connection $connection */
        $connection = $request->attributes->get(AuthenticateMt5Connector::CONNECTION_ATTRIBUTE);

        $run = DB::transaction(function () use ($connection): ?Mt5SyncRun {
            $run = Mt5SyncRun::query()
                ->where('connection_id', $connection->getKey())
                ->where(function ($query): void {
                    $query->where('status', 'queued')
                        ->orWhere(function ($query): void {
                            $query->where('status', 'running')
                                ->where('claimed_at', '<=', now()->subMinutes(5));
                        });
                })
                ->oldest('id')
                ->lockForUpdate()
                ->first();

            if ($run === null) {
                return null;
            }

            if ($run->status === 'queued') {
                $run->status = 'running';
                $run->started_at = now();
            }
            $run->claimed_at = now();
            $run->save();

            return $run;
        });

        return response()->json([
            'data' => $run === null ? null : [
                'id' => $run->getKey(),
                'requested_at' => $run->requested_at?->toIso8601String(),
            ],
        ]);
    }

    public function complete(Request $request, int $run): JsonResponse
    {
        /** @var Mt5Connection $connection */
        $connection = $request->attributes->get(AuthenticateMt5Connector::CONNECTION_ATTRIBUTE);
        $syncRun = Mt5SyncRun::query()
            ->where('connection_id', $connection->getKey())
            ->findOrFail($run);
        if ($syncRun->status === 'succeeded') {
            return response()->json(['data' => ['status' => 'succeeded']]);
        }
        if ($syncRun->status !== 'running') {
            return response()->json(['message' => 'This synchronization is no longer active.'], 409);
        }

        $validated = $request->validate([
            'account' => ['required', 'array'],
            'account.login' => ['required', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'account.server' => ['required', 'string', 'max:255'],
            'account.currency' => ['required', 'string', 'regex:/\A[A-Z]{3}\z/'],
            'account.balance' => ['required', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'account.equity' => ['required', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'account.leverage' => ['required', 'integer', 'between:1,1000000'],
            'account.trade_mode' => ['required', 'integer', Rule::in([0, 2])],
            'orders' => ['present', 'array', 'max:10000'],
            'orders.*.ticket' => ['required', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'orders.*.position_id' => ['nullable', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'orders.*.symbol' => ['nullable', 'string', 'max:32'],
            'orders.*.order_type' => ['nullable', 'string', 'max:40'],
            'orders.*.state' => ['nullable', 'string', 'max:40'],
            'orders.*.volume_initial' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'orders.*.volume_current' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'orders.*.price_open' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'orders.*.price_current' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'orders.*.time_setup' => ['nullable', 'date'],
            'orders.*.time_done' => ['nullable', 'date'],
            'orders.*.payload' => ['required', 'array'],
            'deals' => ['present', 'array', 'max:10000'],
            'deals.*.ticket' => ['required', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'deals.*.order_ticket' => ['nullable', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'deals.*.position_id' => ['nullable', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'deals.*.symbol' => ['nullable', 'string', 'max:32'],
            'deals.*.deal_type' => ['nullable', 'string', 'max:40'],
            'deals.*.entry_type' => ['nullable', 'string', 'max:40'],
            'deals.*.volume' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'deals.*.price' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'deals.*.commission' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'deals.*.swap' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'deals.*.profit' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'deals.*.fee' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'deals.*.occurred_at' => ['nullable', 'date'],
            'deals.*.payload' => ['required', 'array'],
            'positions' => ['present', 'array', 'max:10000'],
            'positions.*.ticket' => ['required', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'positions.*.position_id' => ['nullable', 'string', 'regex:/\A[0-9]{1,20}\z/'],
            'positions.*.symbol' => ['nullable', 'string', 'max:32'],
            'positions.*.position_type' => ['nullable', 'string', 'max:40'],
            'positions.*.volume' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.price_open' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.price_current' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.stop_loss' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.take_profit' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.swap' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.profit' => ['nullable', 'numeric', 'between:-99999999999999.99999999,99999999999999.99999999'],
            'positions.*.opened_at' => ['nullable', 'date'],
            'positions.*.payload' => ['required', 'array'],
        ]);

        $accountData = $validated['account'];
        if ($connection->account_id === null
            || $connection->is_demo !== ($accountData['trade_mode'] === 0)
            || $connection->account_login !== $accountData['login']
            || $connection->server !== $accountData['server']) {
            $syncRun->status = 'failed';
            $syncRun->error_code = 'account_mismatch';
            $syncRun->finished_at = now();
            $syncRun->save();
            $connection->status = 'error';
            $connection->last_error_code = 'account_mismatch';
            $connection->save();

            return response()->json(['message' => 'The active terminal account does not match the confirmed trading account.'], 409);
        }

        DB::transaction(function () use ($connection, $syncRun, $validated): void {
            $now = now();
            $orders = array_map(fn (array $row): array => [
                'connection_id' => $connection->getKey(),
                'ticket' => $row['ticket'],
                'position_id' => $row['position_id'] ?? null,
                'symbol' => $row['symbol'] ?? null,
                'order_type' => $row['order_type'] ?? null,
                'state' => $row['state'] ?? null,
                'volume_initial' => $row['volume_initial'] ?? null,
                'volume_current' => $row['volume_current'] ?? null,
                'price_open' => $row['price_open'] ?? null,
                'price_current' => $row['price_current'] ?? null,
                'time_setup' => $this->databaseDate($row['time_setup'] ?? null),
                'time_done' => $this->databaseDate($row['time_done'] ?? null),
                'payload' => json_encode($row['payload'], JSON_THROW_ON_ERROR),
                'created_at' => $now,
                'updated_at' => $now,
            ], $validated['orders']);

            $deals = array_map(fn (array $row): array => [
                'connection_id' => $connection->getKey(),
                'ticket' => $row['ticket'],
                'order_ticket' => $row['order_ticket'] ?? null,
                'position_id' => $row['position_id'] ?? null,
                'symbol' => $row['symbol'] ?? null,
                'deal_type' => $row['deal_type'] ?? null,
                'entry_type' => $row['entry_type'] ?? null,
                'volume' => $row['volume'] ?? null,
                'price' => $row['price'] ?? null,
                'commission' => $row['commission'] ?? 0,
                'swap' => $row['swap'] ?? 0,
                'profit' => $row['profit'] ?? 0,
                'fee' => $row['fee'] ?? 0,
                'occurred_at' => $this->databaseDate($row['occurred_at'] ?? null),
                'payload' => json_encode($row['payload'], JSON_THROW_ON_ERROR),
                'created_at' => $now,
                'updated_at' => $now,
            ], $validated['deals']);

            $positions = array_map(fn (array $row): array => [
                'connection_id' => $connection->getKey(),
                'ticket' => $row['ticket'],
                'position_id' => $row['position_id'] ?? null,
                'symbol' => $row['symbol'] ?? null,
                'position_type' => $row['position_type'] ?? null,
                'volume' => $row['volume'] ?? null,
                'price_open' => $row['price_open'] ?? null,
                'price_current' => $row['price_current'] ?? null,
                'stop_loss' => $row['stop_loss'] ?? null,
                'take_profit' => $row['take_profit'] ?? null,
                'swap' => $row['swap'] ?? 0,
                'profit' => $row['profit'] ?? 0,
                'opened_at' => $this->databaseDate($row['opened_at'] ?? null),
                'is_open' => true,
                'last_seen_at' => $now,
                'payload' => json_encode($row['payload'], JSON_THROW_ON_ERROR),
                'created_at' => $now,
                'updated_at' => $now,
            ], $validated['positions']);

            DB::table('mt5_open_positions')
                ->where('connection_id', $connection->getKey())
                ->update(['is_open' => false, 'updated_at' => $now]);

            if ($orders !== []) {
                DB::table('mt5_imported_orders')->upsert(
                    $orders,
                    ['connection_id', 'ticket'],
                    ['position_id', 'symbol', 'order_type', 'state', 'volume_initial', 'volume_current', 'price_open', 'price_current', 'time_setup', 'time_done', 'payload', 'updated_at'],
                );
            }
            if ($deals !== []) {
                DB::table('mt5_imported_deals')->upsert(
                    $deals,
                    ['connection_id', 'ticket'],
                    ['order_ticket', 'position_id', 'symbol', 'deal_type', 'entry_type', 'volume', 'price', 'commission', 'swap', 'profit', 'fee', 'occurred_at', 'payload', 'updated_at'],
                );
            }
            if ($positions !== []) {
                DB::table('mt5_open_positions')->upsert(
                    $positions,
                    ['connection_id', 'ticket'],
                    ['position_id', 'symbol', 'position_type', 'volume', 'price_open', 'price_current', 'stop_loss', 'take_profit', 'swap', 'profit', 'opened_at', 'is_open', 'last_seen_at', 'payload', 'updated_at'],
                );
            }

            $syncRun->status = 'succeeded';
            $syncRun->orders_count = count($orders);
            $syncRun->deals_count = count($deals);
            $syncRun->positions_count = count($positions);
            $syncRun->finished_at = $now;
            $syncRun->error_code = null;
            $syncRun->save();

            $connection->balance = $validated['account']['balance'];
            $connection->equity = $validated['account']['equity'];
            $connection->last_sync_at = $now;
            $connection->last_error_code = null;
            $connection->status = 'connected';
            $connection->save();
        });

        return response()->json(['data' => ['status' => 'succeeded']]);
    }

    public function fail(Request $request, int $run): JsonResponse
    {
        /** @var Mt5Connection $connection */
        $connection = $request->attributes->get(AuthenticateMt5Connector::CONNECTION_ATTRIBUTE);
        $validated = $request->validate([
            'error_code' => ['required', Rule::in(self::ERROR_CODES)],
        ]);
        $syncRun = Mt5SyncRun::query()
            ->where('connection_id', $connection->getKey())
            ->findOrFail($run);

        if (in_array($syncRun->status, ['succeeded', 'failed'], true)) {
            return response()->json(['data' => ['status' => $syncRun->status]]);
        }

        $syncRun->status = 'failed';
        $syncRun->error_code = $validated['error_code'];
        $syncRun->finished_at = now();
        $syncRun->save();
        $connection->status = 'error';
        $connection->last_error_code = $validated['error_code'];
        $connection->save();

        return response()->json(['data' => ['status' => 'failed']]);
    }

    private function databaseDate(?string $value): ?string
    {
        return $value === null ? null : CarbonImmutable::parse($value)->utc()->format('Y-m-d H:i:s');
    }
}
