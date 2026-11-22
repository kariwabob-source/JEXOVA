<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\Mt5Connection;
use App\Models\Mt5Pairing;
use App\Models\Mt5SyncRun;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class Mt5ConnectionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $connections = Mt5Connection::query()
            ->where('user_id', $request->user()->getKey())
            ->with(['account', 'latestSyncRun'])
            ->latest('id')
            ->get()
            ->map(function (Mt5Connection $connection): array {
                $latestSync = $connection->latestSyncRun;
                $status = $connection->status;
                if (in_array($status, ['connected', 'pending_confirmation'], true)
                    && $connection->updated_at?->lt(now()->subSeconds(60))) {
                    $status = 'disconnected';
                }

                return [
                    'id' => $connection->getKey(),
                    'account_name' => $connection->account?->name ?? $connection->account_name,
                    'status' => $status,
                    'login_masked' => $this->maskLogin($connection->account_login),
                    'server' => $connection->server,
                    'currency' => $connection->currency,
                    'balance' => $connection->balance,
                    'equity' => $connection->equity,
                    'leverage' => $connection->leverage,
                    'is_demo' => $connection->is_demo,
                    'account_type' => $connection->account_login === null
                        ? null
                        : ($connection->is_demo ? 'demo' : 'live'),
                    'last_sync_at' => $connection->last_sync_at?->toIso8601String(),
                    'last_error_code' => $connection->last_error_code,
                    'latest_sync' => $latestSync === null ? null : [
                        'id' => $latestSync->getKey(),
                        'status' => $latestSync->status,
                        'orders_count' => $latestSync->orders_count,
                        'deals_count' => $latestSync->deals_count,
                        'positions_count' => $latestSync->positions_count,
                        'requested_at' => $latestSync->requested_at?->toIso8601String(),
                        'finished_at' => $latestSync->finished_at?->toIso8601String(),
                        'error_code' => $latestSync->error_code,
                    ],
                ];
            });

        return response()->json(['data' => $connections]);
    }

    public function createPairing(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'account_name' => ['required', 'string', 'max:120'],
        ]);
        $pairingCode = bin2hex(random_bytes(32));
        $expiresAt = now()->addMinutes(10);

        $connection = DB::transaction(function () use ($request, $validated, $pairingCode, $expiresAt): Mt5Connection {
            $connection = Mt5Connection::query()->create([
                'user_id' => $request->user()->getKey(),
                'account_name' => $validated['account_name'],
                'status' => 'pending',
            ]);

            Mt5Pairing::query()->create([
                'connection_id' => $connection->getKey(),
                'code_hash' => hash('sha256', $pairingCode),
                'expires_at' => $expiresAt,
            ]);

            return $connection;
        });

        return response()->json([
            'data' => [
                'connection_id' => $connection->getKey(),
                'pairing_code' => $pairingCode,
                'expires_at' => $expiresAt->toIso8601String(),
            ],
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function requestSync(Request $request, int $connection): JsonResponse
    {
        $owned = $this->ownedConnection($request, $connection);
        if ($owned->status !== 'connected'
            || $owned->updated_at?->lt(now()->subSeconds(60))
            || $owned->account_id === null
            || $owned->token_hash === null) {
            return response()->json([
                'message' => 'Confirm a verified MT5 trading account before requesting synchronization.',
            ], 409);
        }

        $run = Mt5SyncRun::query()->create([
            'connection_id' => $owned->getKey(),
            'requested_by' => $request->user()->getKey(),
            'status' => 'queued',
            'requested_at' => now(),
        ]);

        return response()->json([
            'data' => [
                'id' => $run->getKey(),
                'status' => $run->status,
                'requested_at' => $run->requested_at->toIso8601String(),
            ],
        ], 202);
    }

    public function confirm(Request $request, int $connection): JsonResponse
    {
        $this->ownedConnection($request, $connection);
        $status = DB::transaction(function () use ($request, $connection): string {
            $owned = Mt5Connection::query()
                ->where('user_id', $request->user()->getKey())
                ->whereKey($connection)
                ->lockForUpdate()
                ->firstOrFail();

            if ($owned->status === 'connected' && $owned->account_id !== null) {
                return 'connected';
            }
            if ($owned->status !== 'pending_confirmation'
                || $owned->token_hash === null
                || $owned->updated_at?->lt(now()->subSeconds(60))
                || $owned->account_login === null
                || $owned->server === null
                || $owned->currency === null) {
                abort(409, 'This trading account is not ready for confirmation.');
            }

            $account = new Account;
            $account->user_id = $owned->user_id;
            $account->name = $owned->account_name;
            $account->account_type = $owned->is_demo ? 'demo' : 'real';
            $account->broker_name = $owned->server;
            $account->connection_method = 'mt5';
            $account->platform = 'MetaTrader 5';
            $account->currency = $owned->currency;
            $account->starting_balance = '0.00';
            $account->save();

            $owned->account_id = $account->getKey();
            $owned->status = 'connected';
            $owned->save();

            return $owned->status;
        });

        return response()->json(['data' => ['status' => $status]]);
    }

    public function syncHistory(Request $request, int $connection): JsonResponse
    {
        $owned = $this->ownedConnection($request, $connection);
        $runs = $owned->syncRuns()
            ->latest('id')
            ->paginate(20)
            ->through(fn (Mt5SyncRun $run): array => [
                'id' => $run->getKey(),
                'status' => $run->status,
                'orders_count' => $run->orders_count,
                'deals_count' => $run->deals_count,
                'positions_count' => $run->positions_count,
                'requested_at' => $run->requested_at?->toIso8601String(),
                'started_at' => $run->started_at?->toIso8601String(),
                'finished_at' => $run->finished_at?->toIso8601String(),
                'error_code' => $run->error_code,
            ]);

        return response()->json($runs);
    }

    public function revoke(Request $request, int $connection): Response
    {
        $owned = $this->ownedConnection($request, $connection);
        $owned->token_hash = null;
        $owned->status = 'revoked';
        $owned->last_error_code = null;
        $owned->save();

        return response()->noContent();
    }

    private function ownedConnection(Request $request, int $connection): Mt5Connection
    {
        return Mt5Connection::query()
            ->where('user_id', $request->user()->getKey())
            ->findOrFail($connection);
    }

    private function maskLogin(?string $login): ?string
    {
        if ($login === null) {
            return null;
        }

        return str_repeat('*', max(4, strlen($login) - 4)).substr($login, -4);
    }
}
