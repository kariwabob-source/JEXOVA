<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use Illuminate\Database\Connection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class AccountManagementTest extends TestCase
{
    private Connection $testConnection;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertSame('mysql', config('database.default'));
        $this->assertSame('edgeledger_test', config('database.connections.mysql.database'));
        $this->testConnection = DB::connection('mysql');
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

    public function test_owner_can_create_demo_real_and_prop_firm_manual_accounts(): void
    {
        foreach ([
            ['account_type' => 'demo', 'phase' => null],
            ['account_type' => 'real', 'phase' => null],
            ['account_type' => 'prop_firm', 'phase' => 'Evaluation Phase 1'],
        ] as $case) {
            $payload = $this->validPayload($case['account_type']);
            if ($case['phase'] !== null) {
                $payload['challenge_phase'] = $case['phase'];
                $payload['nominal_account_size'] = '100000.00';
            }

            $created = $this->postJson('/accounts', $payload)
                ->assertCreated()
                ->assertJsonPath('data.account_type', $case['account_type'])
                ->assertJsonPath('data.connection_method', 'manual')
                ->assertJsonPath('data.currency', 'USD')
                ->assertJsonPath('data.starting_balance', '1250.75')
                ->assertJsonMissingPath('data.account_reference')
                ->json('data');

            $this->assertDatabaseHas('accounts', [
                'id' => $created['id'],
                'user_id' => $this->owner->getKey(),
                'account_type' => $case['account_type'],
                'connection_method' => 'manual',
            ], 'mysql');

            $storedReference = DB::table('accounts')->where('id', $created['id'])->value('account_reference');
            $this->assertNotSame($payload['account_reference'], $storedReference);
            $this->assertSame($payload['account_reference'], Account::query()->findOrFail($created['id'])->account_reference);
        }
    }

    public function test_prop_firm_phases_are_supported_and_other_account_types_reject_them(): void
    {
        foreach (['Evaluation Phase 1', 'Evaluation Phase 2', 'Funded', 'Instant Funding'] as $phase) {
            $payload = $this->validPayload('prop_firm');
            $payload['challenge_phase'] = $phase;

            $this->postJson('/accounts', $payload)
                ->assertCreated()
                ->assertJsonPath('data.challenge_phase', $phase);
        }

        $payload = $this->validPayload('demo');
        $payload['challenge_phase'] = 'Funded';
        $this->postJson('/accounts', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['challenge_phase']);

        $payload = $this->validPayload('prop_firm');
        $payload['challenge_phase'] = 'Unsupported Phase';
        $this->postJson('/accounts', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['challenge_phase']);
    }

    public function test_manual_account_required_fields_and_connection_method_are_validated(): void
    {
        foreach (['name', 'currency', 'starting_balance'] as $field) {
            $payload = $this->validPayload();
            unset($payload[$field]);

            $this->postJson('/accounts', $payload)
                ->assertUnprocessable()
                ->assertJsonValidationErrors([$field]);
        }

        $payload = $this->validPayload();
        $payload['connection_method'] = 'mt5';
        $this->postJson('/accounts', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['connection_method']);

        $payload = $this->validPayload();
        $payload['currency'] = 'US';
        $this->postJson('/accounts', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['currency']);

        $payload = $this->validPayload();
        $payload['starting_balance'] = '1.001';
        $this->postJson('/accounts', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['starting_balance']);
    }

    public function test_minimal_manual_account_does_not_require_broker_type_platform_or_mt5(): void
    {
        $account = $this->postJson('/accounts', [
            'name' => 'Manual only '.Str::random(8),
            'currency' => 'USD',
            'starting_balance' => '5000.00',
        ])
            ->assertCreated()
            ->assertJsonPath('data.account_type', null)
            ->assertJsonPath('data.broker_name', null)
            ->assertJsonPath('data.platform', 'Manual')
            ->assertJsonPath('data.connection_method', 'manual')
            ->json('data');

        $this->assertDatabaseHas('accounts', [
            'id' => $account['id'],
            'user_id' => $this->owner->getKey(),
            'name' => $account['name'],
            'account_type' => null,
            'broker_name' => null,
            'platform' => 'Manual',
            'connection_method' => 'manual',
            'currency' => 'USD',
            'starting_balance' => '5000.00',
        ], 'mysql');
    }

    public function test_guest_cannot_create_a_manual_account(): void
    {
        auth()->logout();

        $this->postJson('/accounts', $this->validPayload())
            ->assertUnauthorized();
    }

    public function test_manual_account_is_owned_listed_and_available_for_trade_creation(): void
    {
        $foreignUserId = DB::table('users')->insertGetId([
            'name' => 'Foreign account owner',
            'email' => 'foreign-account-'.Str::uuid().'@example.test',
            'password_hash' => null,
        ]);
        $foreignUser = User::query()->findOrFail($foreignUserId);
        $payload = $this->validPayload('real');
        $payload['user_id'] = $foreignUser->getKey();
        $account = $this->postJson('/accounts', $payload)
            ->assertCreated()
            ->json('data');

        $this->assertDatabaseHas('accounts', [
            'id' => $account['id'],
            'user_id' => $this->owner->getKey(),
        ], 'mysql');

        $options = $this->getJson('/trade-options')->assertOk();
        $this->assertTrue(collect($options->json('accounts'))->contains(
            fn (array $candidate): bool => $candidate['id'] === $account['id']
                && $candidate['account_type'] === 'real'
                && $candidate['connection_method'] === 'manual'
                && $candidate['connection_status'] === 'manual',
        ));

        $trade = $this->postJson('/trades', $this->validTradePayload($account['id']))
            ->assertCreated()
            ->json('data');
        $this->assertSame($account['id'], $trade['account_id']);
        $this->assertSame($account['id'], DB::table('trades')->where('id', $trade['id'])->value('account_id'));

        $foreignAccount = $foreignUser->accounts()->create([
            'name' => 'Foreign account',
            'account_type' => 'demo',
            'broker_name' => 'Other Broker',
            'platform' => 'MT5',
            'connection_method' => 'manual',
            'currency' => 'USD',
            'starting_balance' => '0.00',
        ]);
        $this->postJson('/trades', $this->validTradePayload($foreignAccount->getKey()))
            ->assertNotFound();
    }

    public function test_legacy_accounts_remain_listable_when_their_type_is_unclassified(): void
    {
        $legacy = $this->owner->accounts()->create([
            'name' => 'Legacy unclassified account',
            'account_type' => null,
            'broker_name' => null,
            'platform' => 'Legacy Platform',
            'connection_method' => 'manual',
            'currency' => 'USD',
            'starting_balance' => '50.00',
        ]);

        $this->getJson('/trade-options')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $legacy->getKey(),
                'account_type' => null,
                'connection_method' => 'manual',
            ]);
    }

    private function validPayload(string $accountType = 'demo'): array
    {
        return [
            'name' => 'Account '.Str::random(8),
            'account_type' => $accountType,
            'broker_name' => 'Example Broker',
            'platform' => 'MetaTrader 5',
            'connection_method' => 'manual',
            'currency' => 'USD',
            'starting_balance' => '1250.75',
            'account_reference' => 'private-reference-'.Str::random(8),
        ];
    }

    private function validTradePayload(int $accountId): array
    {
        return [
            'account_id' => $accountId,
            'symbol' => 'EURUSD',
            'side' => 'long',
            'trading_session' => 'London Session',
            'market_condition' => 'Ranging',
            'trend_direction' => null,
            'opened_at' => Carbon::now()->subHour()->format('Y-m-d\TH:i'),
            'entry_price' => '1.10000000',
            'quantity' => '0.10',
            'pnl' => '0.00',
            'status' => 'open',
        ];
    }
}