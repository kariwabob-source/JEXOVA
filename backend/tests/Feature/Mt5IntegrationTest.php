<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Database\Connection;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class Mt5IntegrationTest extends TestCase
{
    private Connection $testConnection;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->assertSame('mysql', config('database.default'));
        $this->assertSame('edgeledger_test', config('database.connections.mysql.database'));
        $this->assertSame('127.0.0.1', config('database.connections.mysql.host'));
        $this->assertSame('3306', (string) config('database.connections.mysql.port'));

        $this->testConnection = DB::connection('mysql');
        $this->assertSame('edgeledger_test', $this->testConnection->getDatabaseName());
        $this->testConnection->beginTransaction();

        $this->owner = User::query()->whereNotNull('email')->whereHas('accounts')->firstOrFail();
        if (! $this->owner->hasVerifiedEmail()) {
            $this->owner->forceFill(['email_verified_at' => now()])->save();
        }
        $this->actingAs($this->owner);
    }

    protected function tearDown(): void
    {
        if (isset($this->testConnection) && $this->testConnection->transactionLevel() > 0) {
            $this->testConnection->rollBack();
        }

        parent::tearDown();
    }

    public function test_pairing_codes_are_single_use_and_accounts_require_confirmation(): void
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'MT5 account '.Str::random(8),
        ])->assertCreated()->json('data');

        $this->assertSame(64, strlen($pairing['pairing_code']));
        $connector = $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertCreated()->json('data');

        $this->assertNotSame($connector['connector_token'], DB::table('mt5_connections')
            ->where('id', $pairing['connection_id'])
            ->value('token_hash'));
        $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertUnprocessable();

        $this->withHeader('Authorization', 'Bearer '.$connector['connector_token'])
            ->postJson('/api/mt5/connector/status', [
                'status' => 'connected',
                'account' => $this->accountPayload(),
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'pending_confirmation')
            ->assertJsonPath('data.account_type', 'demo');
        $list = $this->getJson('/mt5/connections')
            ->assertOk()
            ->assertJsonPath('data.0.login_masked', '****5678')
            ->assertJsonPath('data.0.is_demo', true)
            ->assertJsonPath('data.0.account_type', 'demo')
            ->assertJsonPath('data.0.status', 'pending_confirmation');

        $list->assertJsonMissingPath('data.0.token_hash');
        $list->assertJsonMissingPath('data.0.account_login');
        $list->assertJsonMissingPath('data.0.connector_token');
        $this->assertDatabaseHas('mt5_connections', [
            'id' => $pairing['connection_id'],
            'account_id' => null,
            'status' => 'pending_confirmation',
        ], 'mysql');

        $this->postJson("/mt5/connections/{$pairing['connection_id']}/sync")->assertStatus(409);
        $accountCount = DB::table('accounts')->where('user_id', $this->owner->getKey())->count();
        $this->postJson("/mt5/connections/{$pairing['connection_id']}/confirm")
            ->assertOk()
            ->assertJsonPath('data.status', 'connected');
        $this->postJson("/mt5/connections/{$pairing['connection_id']}/confirm")->assertOk();
        $this->assertSame(
            $accountCount + 1,
            DB::table('accounts')->where('user_id', $this->owner->getKey())->count(),
        );
        $accountId = DB::table('mt5_connections')->where('id', $pairing['connection_id'])->value('account_id');
        $this->assertDatabaseHas('accounts', [
            'id' => $accountId,
            'account_type' => 'demo',
            'broker_name' => 'MetaQuotes-Demo',
            'connection_method' => 'mt5',
        ], 'mysql');
        $this->getJson('/trade-options')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $accountId,
                'broker_name' => 'MetaQuotes-Demo',
                'connection_status' => 'connected',
                'synchronization_status' => 'not_synced',
            ]);
        $this->assertDatabaseHas('mt5_connections', [
            'id' => $pairing['connection_id'],
            'status' => 'connected',
        ], 'mysql');
    }

    public function test_unverified_owner_cannot_redeem_a_pending_pairing_code(): void
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'MT5 account '.Str::random(8),
        ])->assertCreated()->json('data');

        $this->owner->forceFill(['email_verified_at' => null])->save();

        $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertForbidden();

        $this->assertDatabaseHas('mt5_connections', [
            'id' => $pairing['connection_id'],
            'token_hash' => null,
        ]);
    }

    public function test_unverified_owner_cannot_use_an_existing_connector_token(): void
    {
        [$connectionId, $token] = $this->createVerifiedConnection();
        $this->owner->forceFill(['email_verified_at' => null])->save();

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/mt5/connector/jobs/next')
            ->assertForbidden();

        $this->assertDatabaseHas('mt5_connections', [
            'id' => $connectionId,
            'token_hash' => hash('sha256', strtolower($token)),
        ]);
    }

    public function test_server_rejects_unsupported_contest_accounts_and_connector_requests_without_a_token(): void
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'Unverified MT5 '.Str::random(8),
        ])->assertCreated()->json('data');
        $connector = $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertCreated()->json('data');

        $this->postJson('/api/mt5/connector/status', [
            'status' => 'connected',
            'account' => [...$this->accountPayload(), 'trade_mode' => 1],
        ])->assertUnauthorized();

        $this->withHeader('Authorization', 'Bearer '.$connector['connector_token'])
            ->postJson('/api/mt5/connector/status', [
                'status' => 'connected',
                'account' => [...$this->accountPayload(), 'trade_mode' => 1],
            ])
            ->assertUnprocessable();

        $this->assertDatabaseHas('mt5_connections', [
            'id' => $pairing['connection_id'],
            'status' => 'paired',
            'is_demo' => 0,
            'account_id' => null,
        ], 'mysql');
    }

    public function test_historical_orders_deals_and_positions_import_idempotently_without_creating_trades(): void
    {
        [$connectionId, $token] = $this->createVerifiedConnection();
        $tradeCount = DB::table('trades')->count();
        $manualTrade = DB::table('trades')->orderBy('id')->first(['id', 'external_id', 'symbol', 'pnl', 'status']);
        $payload = $this->snapshotPayload();

        $run = $this->postJson("/mt5/connections/{$connectionId}/sync")
            ->assertAccepted()
            ->assertJsonPath('data.status', 'queued')
            ->json('data');
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/mt5/connector/jobs/next')
            ->assertOk()
            ->assertJsonPath('data.id', $run['id']);
        $this->postJson("/api/mt5/connector/jobs/{$run['id']}/complete", $payload)
            ->assertOk()
            ->assertJsonPath('data.status', 'succeeded');

        $this->assertSame(1, DB::table('mt5_imported_orders')->where('connection_id', $connectionId)->count());
        $this->assertSame(2, DB::table('mt5_imported_deals')->where('connection_id', $connectionId)->count());
        $this->assertSame(1, DB::table('mt5_open_positions')->where('connection_id', $connectionId)->where('is_open', true)->count());
        $this->assertSame($tradeCount, DB::table('trades')->count());
        $this->assertEquals($manualTrade, DB::table('trades')->where('id', $manualTrade->id)->first(['id', 'external_id', 'symbol', 'pnl', 'status']));
        $this->assertSame(
            2,
            DB::table('mt5_imported_deals')
                ->where('connection_id', $connectionId)
                ->where('position_id', '700001')
                ->count(),
            'Separate executions for a position must remain separate deal records.',
        );

        $secondRun = $this->postJson("/mt5/connections/{$connectionId}/sync")
            ->assertAccepted()
            ->json('data');
        $this->getJson('/api/mt5/connector/jobs/next')
            ->assertOk()
            ->assertJsonPath('data.id', $secondRun['id']);
        $payload['positions'] = [];
        $this->postJson("/api/mt5/connector/jobs/{$secondRun['id']}/complete", $payload)
            ->assertOk();

        $this->assertSame(1, DB::table('mt5_imported_orders')->where('connection_id', $connectionId)->count());
        $this->assertSame(2, DB::table('mt5_imported_deals')->where('connection_id', $connectionId)->count());
        $this->assertSame(0, DB::table('mt5_open_positions')->where('connection_id', $connectionId)->where('is_open', true)->count());
        $this->assertSame($tradeCount, DB::table('trades')->count());
        $this->assertEquals($manualTrade, DB::table('trades')->where('id', $manualTrade->id)->first(['id', 'external_id', 'symbol', 'pnl', 'status']));
        $this->getJson("/mt5/connections/{$connectionId}/syncs")
            ->assertOk()
            ->assertJsonPath('data.0.status', 'succeeded')
            ->assertJsonPath('data.0.deals_count', 2);
    }

    public function test_users_cannot_queue_or_read_syncs_for_another_users_connection(): void
    {
        [$connectionId] = $this->createVerifiedConnection();
        $foreignUserId = DB::table('users')->insertGetId([
            'name' => 'MT5 ownership test',
            'email' => 'mt5-owner-'.Str::uuid().'@example.test',
            'email_verified_at' => now(),
        ]);
        $foreignUser = User::query()->findOrFail($foreignUserId);
        $this->actingAs($foreignUser);

        $this->postJson("/mt5/connections/{$connectionId}/confirm")->assertNotFound();
        $this->postJson("/mt5/connections/{$connectionId}/sync")->assertNotFound();
        $this->postJson("/mt5/connections/{$connectionId}/revoke")->assertNotFound();
        $this->getJson("/mt5/connections/{$connectionId}/syncs")->assertNotFound();
        $this->getJson('/mt5/connections')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_owner_can_revoke_a_connector_without_deleting_imported_records(): void
    {
        [$connectionId, $token] = $this->createVerifiedConnection();
        DB::table('mt5_imported_deals')->insert([
            'connection_id' => $connectionId,
            'ticket' => '990001',
            'position_id' => '700001',
            'payload' => json_encode(['ticket' => 990001], JSON_THROW_ON_ERROR),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->postJson("/mt5/connections/{$connectionId}/revoke")->assertNoContent();
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/mt5/connector/jobs/next')
            ->assertUnauthorized();

        $this->assertDatabaseHas('mt5_connections', [
            'id' => $connectionId,
            'status' => 'revoked',
            'token_hash' => null,
        ], 'mysql');
        $this->assertDatabaseHas('mt5_imported_deals', [
            'connection_id' => $connectionId,
            'ticket' => '990001',
        ], 'mysql');
    }

    public function test_invalid_import_payload_fails_validation_without_partial_source_records(): void
    {
        [$connectionId, $token] = $this->createVerifiedConnection();
        $run = $this->postJson("/mt5/connections/{$connectionId}/sync")->assertAccepted()->json('data');
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/mt5/connector/jobs/next')
            ->assertOk();

        $payload = $this->snapshotPayload();
        $payload['deals'][0]['ticket'] = 'not-a-ticket';
        $this->postJson("/api/mt5/connector/jobs/{$run['id']}/complete", $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['deals.0.ticket']);

        $this->assertSame(0, DB::table('mt5_imported_orders')->where('connection_id', $connectionId)->count());
        $this->assertSame(0, DB::table('mt5_imported_deals')->where('connection_id', $connectionId)->count());
    }

    public function test_live_account_is_classified_and_must_be_confirmed_before_sync(): void
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'MT5 live '.Str::random(8),
        ])->assertCreated()->json('data');
        $connector = $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertCreated()->json('data');

        $this->withHeader('Authorization', 'Bearer '.$connector['connector_token'])
            ->postJson('/api/mt5/connector/status', [
                'status' => 'connected',
                'account' => [...$this->accountPayload(), 'trade_mode' => 2],
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'pending_confirmation')
            ->assertJsonPath('data.account_type', 'live');

        $this->getJson('/mt5/connections')
            ->assertOk()
            ->assertJsonPath('data.0.account_type', 'live')
            ->assertJsonPath('data.0.status', 'pending_confirmation');
        $this->postJson("/mt5/connections/{$pairing['connection_id']}/sync")->assertStatus(409);

        $this->postJson("/mt5/connections/{$pairing['connection_id']}/confirm")
            ->assertOk()
            ->assertJsonPath('data.status', 'connected');
        $accountId = DB::table('mt5_connections')->where('id', $pairing['connection_id'])->value('account_id');
        $this->assertDatabaseHas('accounts', [
            'id' => $accountId,
            'account_type' => 'real',
            'connection_method' => 'mt5',
        ], 'mysql');
        $this->postJson("/mt5/connections/{$pairing['connection_id']}/sync")
            ->assertAccepted()
            ->assertJsonPath('data.status', 'queued');
    }

    public function test_a_terminal_account_type_change_requires_a_new_pairing(): void
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'MT5 type check '.Str::random(8),
        ])->assertCreated()->json('data');
        $connector = $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertCreated()->json('data');
        $this->registerDemoAccount($connector['connector_token']);

        $this->withHeader('Authorization', 'Bearer '.$connector['connector_token'])
            ->postJson('/api/mt5/connector/status', [
                'status' => 'connected',
                'account' => [...$this->accountPayload(), 'trade_mode' => 2],
            ])
            ->assertStatus(409);

        $this->assertDatabaseHas('mt5_connections', [
            'id' => $pairing['connection_id'],
            'is_demo' => 1,
            'status' => 'error',
            'last_error_code' => 'account_mismatch',
        ], 'mysql');
    }

    public function test_expired_pairing_code_cannot_be_exchanged(): void
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'Expired MT5 '.Str::random(8),
        ])->assertCreated()->json('data');
        DB::table('mt5_pairings')
            ->where('connection_id', $pairing['connection_id'])
            ->update(['expires_at' => now()->subSecond()]);

        $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertUnprocessable();
    }

    public function test_stale_connector_heartbeat_is_reported_as_disconnected_and_cannot_sync(): void
    {
        [$connectionId] = $this->createVerifiedConnection();
        DB::table('mt5_connections')
            ->where('id', $connectionId)
            ->update(['updated_at' => now()->subSeconds(61)]);

        $this->getJson('/mt5/connections')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'disconnected');
        $this->postJson("/mt5/connections/{$connectionId}/sync")->assertStatus(409);
    }

    private function createVerifiedConnection(): array
    {
        $pairing = $this->postJson('/mt5/pairings', [
            'account_name' => 'MT5 Demo '.Str::random(8),
        ])->assertCreated()->json('data');
        $connector = $this->postJson('/api/mt5/pair', [
            'pairing_code' => $pairing['pairing_code'],
        ])->assertCreated()->json('data');

        $this->registerDemoAccount($connector['connector_token']);
        $this->postJson("/mt5/connections/{$pairing['connection_id']}/confirm")->assertOk();

        return [$pairing['connection_id'], $connector['connector_token']];
    }

    private function registerDemoAccount(string $token): void
    {
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->postJson('/api/mt5/connector/status', [
                'status' => 'connected',
                'account' => $this->accountPayload(),
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'pending_confirmation')
            ->assertJsonPath('data.account_type', 'demo');
    }

    private function accountPayload(): array
    {
        return [
            'login' => '98765678',
            'server' => 'MetaQuotes-Demo',
            'currency' => 'USD',
            'balance' => 10000.25,
            'equity' => 10025.50,
            'leverage' => 100,
            'trade_mode' => 0,
        ];
    }

    private function snapshotPayload(): array
    {
        return [
            'account' => $this->accountPayload(),
            'orders' => [[
                'ticket' => '800001',
                'position_id' => '700001',
                'symbol' => 'EURUSD',
                'order_type' => '0',
                'state' => '4',
                'volume_initial' => 0.2,
                'volume_current' => 0,
                'price_open' => 1.1,
                'price_current' => 1.1,
                'time_setup' => '2026-01-03T10:00:00+00:00',
                'time_done' => '2026-01-03T10:01:00+00:00',
                'payload' => ['ticket' => 800001, 'comment' => 'demo order'],
            ]],
            'deals' => [
                [
                    'ticket' => '900001',
                    'order_ticket' => '800001',
                    'position_id' => '700001',
                    'symbol' => 'EURUSD',
                    'deal_type' => '0',
                    'entry_type' => '0',
                    'volume' => 0.2,
                    'price' => 1.1,
                    'commission' => -0.5,
                    'swap' => 0,
                    'profit' => 0,
                    'fee' => 0,
                    'occurred_at' => '2026-01-03T10:01:00+00:00',
                    'payload' => ['ticket' => 900001, 'position_id' => 700001],
                ],
                [
                    'ticket' => '900002',
                    'order_ticket' => '800002',
                    'position_id' => '700001',
                    'symbol' => 'EURUSD',
                    'deal_type' => '1',
                    'entry_type' => '1',
                    'volume' => 0.1,
                    'price' => 1.11,
                    'commission' => -0.25,
                    'swap' => 0,
                    'profit' => 1,
                    'fee' => 0,
                    'occurred_at' => '2026-01-03T10:30:00+00:00',
                    'payload' => ['ticket' => 900002, 'position_id' => 700001],
                ],
            ],
            'positions' => [[
                'ticket' => '700001',
                'position_id' => '700001',
                'symbol' => 'EURUSD',
                'position_type' => '0',
                'volume' => 0.1,
                'price_open' => 1.1,
                'price_current' => 1.11,
                'stop_loss' => 1.09,
                'take_profit' => 1.12,
                'swap' => 0,
                'profit' => 1,
                'opened_at' => '2026-01-03T10:01:00+00:00',
                'payload' => ['ticket' => 700001, 'identifier' => 700001],
            ]],
        ];
    }
}
