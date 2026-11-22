<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Database\Connection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class TradeManagementTest extends TestCase
{
    private Connection $testConnection;

    private int $accountId;

    private int $strategyId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertSame('mysql', config('database.default'));
        $this->assertSame('edgeledger_test', config('database.connections.mysql.database'));
        $this->assertSame('127.0.0.1', config('database.connections.mysql.host'));
        $this->assertSame('3306', (string) config('database.connections.mysql.port'));

        $this->testConnection = DB::connection('mysql');
        $this->assertSame('edgeledger_test', $this->testConnection->getDatabaseName());
        $this->testConnection->beginTransaction();

        $user = User::query()->whereNotNull('email')->whereHas('accounts')->firstOrFail();
        if (! $user->hasVerifiedEmail()) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }
        $this->accountId = (int) DB::table('accounts')->where('user_id', $user->getKey())->value('id');
        $this->assertGreaterThan(0, $this->accountId);
        $this->strategyId = (int) DB::table('strategies')->where('account_id', $this->accountId)->value('id');

        $this->actingAs($user);
    }

    protected function tearDown(): void
    {
        if (isset($this->testConnection) && $this->testConnection->transactionLevel() > 0) {
            $this->testConnection->rollBack();
        }

        parent::tearDown();
    }

    public function test_owner_can_list_filter_and_paginate_database_trades(): void
    {
        $closedCount = DB::table('trades')->where('account_id', $this->accountId)->where('status', 'closed')->count();
        $this->getJson('/trades?status=closed&per_page=5')
            ->assertOk()
            ->assertJsonPath('per_page', 5)
            ->assertJsonPath('total', $closedCount)
            ->assertJsonCount(min(5, $closedCount), 'data');

        $trade = DB::table('trades')->where('account_id', $this->accountId)->first(['external_id']);
        $this->getJson('/trades?search='.urlencode($trade->external_id))
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.external_id', $trade->external_id)
            ->assertJsonPath('data.0.account_currency', DB::table('accounts')->where('id', $this->accountId)->value('currency'));

        $this->getJson('/trade-options')
            ->assertOk()
            ->assertJsonPath('accounts.0.id', $this->accountId)
            ->assertJsonPath('accounts.0.currency', DB::table('accounts')->where('id', $this->accountId)->value('currency'));
    }

    public function test_history_filters_by_instrument_strategy_dates_direction_and_outcome_with_pagination(): void
    {
        $strategyId = $this->strategyId;
        if ($strategyId === 0) {
            $strategyId = (int) DB::table('strategies')->insertGetId([
                'account_id' => $this->accountId,
                'name' => 'History test '.Str::uuid(),
            ]);
        }

        $symbol = 'HIST'.Str::upper(Str::random(8));
        $prefix = 'history-'.Str::uuid();
        $ids = [];

        foreach ([
            'win-old' => ['long', 'closed', '10.00', '2026-01-02 10:00:00', '2026-01-02 11:00:00'],
            'win-new' => ['long', 'closed', '20.00', '2026-01-03 10:00:00', '2026-01-03 11:00:00'],
            'loss' => ['short', 'closed', '-5.00', '2026-01-04 10:00:00', '2026-01-04 11:00:00'],
            'open' => ['long', 'open', '0.00', '2026-01-05 10:00:00', null],
        ] as $label => [$side, $status, $pnl, $openedAt, $closedAt]) {
            $ids[$label] = DB::table('trades')->insertGetId([
                'account_id' => $this->accountId,
                'strategy_id' => $strategyId,
                'external_id' => $prefix.'-'.$label,
                'symbol' => $symbol,
                'side' => $side,
                'trading_session' => 'History test',
                'opened_at' => $openedAt,
                'closed_at' => $closedAt,
                'entry_price' => '1.10000000',
                'exit_price' => $status === 'closed' ? '1.11000000' : null,
                'quantity' => '0.10000000',
                'pnl' => $pnl,
                'status' => $status,
            ]);
        }

        $filters = http_build_query([
            'instrument' => $symbol,
            'strategy_id' => $strategyId,
            'from_date' => '2026-01-01',
            'to_date' => '2026-01-31',
            'side' => 'long',
            'outcome' => 'winning',
            'per_page' => 1,
        ]);

        $this->getJson('/trades?'.$filters)
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ids['win-new']);

        $this->getJson('/trades?'.$filters.'&page=2')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonPath('data.0.id', $ids['win-old']);

        $this->getJson('/trades?instrument='.$symbol.'&outcome=losing')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $ids['loss']);

        $this->getJson('/trades?instrument='.$symbol.'&outcome=open')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $ids['open'])
            ->assertJsonPath('data.0.trading_session', 'History test');

        $this->getJson('/trades?search=NO-HISTORY-RESULT')
            ->assertOk()
            ->assertJsonPath('total', 0)
            ->assertJsonCount(0, 'data');
    }

    public function test_journal_search_matches_instrument_external_id_and_strategy_name(): void
    {
        $symbol = 'SEARCH'.Str::upper(Str::random(8));
        $externalId = 'journal-search-'.Str::uuid();
        $strategyName = 'Journal search '.Str::uuid();
        $payload = $this->validPayload();
        $payload['symbol'] = $symbol;
        $payload['external_id'] = $externalId;
        $payload['strategy_name'] = $strategyName;
        unset($payload['strategy_id']);

        $trade = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->json('data');

        foreach ([$symbol, $externalId, $strategyName] as $term) {
            $this->getJson('/trades?'.http_build_query(['search' => $term]))
                ->assertOk()
                ->assertJsonPath('total', 1)
                ->assertJsonPath('data.0.id', $trade['id']);
        }
    }

    public function test_journal_sorting_is_whitelisted_stable_and_paginated(): void
    {
        $prefix = 'SORT'.Str::upper(Str::random(8));
        $rows = [
            'a' => [
                'opened_at' => '2026-01-01 10:00:00',
                'side' => 'long',
                'quantity' => '0.10',
                'pnl' => '0.00',
                'status' => 'open',
            ],
            'b' => [
                'opened_at' => '2026-01-01 10:00:00',
                'side' => 'short',
                'quantity' => '0.50',
                'r_multiple' => '1.0000',
                'pnl' => '10.00',
                'status' => 'closed',
            ],
            'c' => [
                'opened_at' => '2026-01-02 10:00:00',
                'side' => 'long',
                'quantity' => '1.00',
                'r_multiple' => '2.0000',
                'pnl' => '-5.00',
                'status' => 'closed',
            ],
            'd' => [
                'opened_at' => '2026-01-03 10:00:00',
                'side' => 'short',
                'quantity' => '2.35',
                'r_multiple' => '3.0000',
                'pnl' => '25.00',
                'status' => 'closed',
            ],
        ];
        $ids = [];

        foreach ($rows as $label => $row) {
            $ids[$label] = DB::table('trades')->insertGetId([
                'account_id' => $this->accountId,
                'strategy_id' => null,
                'external_id' => $prefix.'-'.$label,
                'symbol' => $prefix.'_'.$label,
                'side' => $row['side'],
                'trading_session' => 'London Session',
                'market_condition' => 'Ranging',
                'trend_direction' => null,
                'opened_at' => $row['opened_at'],
                'closed_at' => $row['status'] === 'open' ? null : '2026-01-04 10:00:00',
                'entry_price' => '1.10000000',
                'exit_price' => $row['status'] === 'open' ? null : '1.11000000',
                'quantity' => $row['quantity'],
                'pnl' => $row['pnl'],
                'r_multiple' => $row['r_multiple'] ?? null,
                'status' => $row['status'],
            ]);
        }

        $expectedOrder = [
            'trade_date' => ['asc' => ['b', 'a', 'c', 'd'], 'desc' => ['d', 'c', 'b', 'a']],
            'instrument' => ['asc' => ['a', 'b', 'c', 'd'], 'desc' => ['d', 'c', 'b', 'a']],
            'direction' => ['asc' => ['c', 'a', 'd', 'b'], 'desc' => ['d', 'b', 'c', 'a']],
            'lot_size' => ['asc' => ['a', 'b', 'c', 'd'], 'desc' => ['d', 'c', 'b', 'a']],
            'r_multiple' => ['asc' => ['a', 'b', 'c', 'd'], 'desc' => ['d', 'c', 'b', 'a']],
            'pnl' => ['asc' => ['c', 'a', 'b', 'd'], 'desc' => ['d', 'b', 'a', 'c']],
            'status' => ['asc' => ['a', 'd', 'c', 'b'], 'desc' => ['d', 'c', 'b', 'a']],
        ];

        foreach ($expectedOrder as $sort => $directions) {
            foreach ($directions as $direction => $labels) {
                $response = $this->getJson('/trades?'.http_build_query([
                    'search' => $prefix,
                    'sort' => $sort,
                    'direction' => $direction,
                    'per_page' => 50,
                ]))->assertOk();

                $this->assertSame(
                    array_map(fn (string $label): int => $ids[$label], $labels),
                    array_column($response->json('data'), 'id'),
                    "Unexpected {$sort} {$direction} ordering.",
                );
            }
        }

        $this->getJson('/trades?'.http_build_query([
            'search' => $prefix,
            'sort' => 'opened_at desc, (select sleep(1))',
            'direction' => 'sideways',
        ]))
            ->assertOk()
            ->assertJsonPath('data.0.id', $ids['d']);

        $firstPage = $this->getJson('/trades?'.http_build_query([
            'search' => $prefix,
            'sort' => 'trade_date',
            'direction' => 'asc',
            'per_page' => 2,
        ]))
            ->assertOk()
            ->assertJsonPath('total', 4)
            ->assertJsonPath('per_page', 2)
            ->assertJsonPath('current_page', 1)
            ->assertJsonPath('last_page', 2)
            ->assertJsonCount(2, 'data');

        $this->getJson('/trades?'.http_build_query([
            'search' => $prefix,
            'sort' => 'trade_date',
            'direction' => 'asc',
            'per_page' => 2,
            'page' => 2,
        ]))
            ->assertOk()
            ->assertJsonPath('data.0.id', $ids['c'])
            ->assertJsonCount(2, 'data');

        $this->getJson('/trades?'.http_build_query([
            'search' => $prefix,
            'per_page' => 50,
        ]))
            ->assertOk()
            ->assertJsonPath('per_page', 50)
            ->assertJsonCount(4, 'data');

        $this->getJson('/trades?'.http_build_query([
            'search' => $prefix,
            'per_page' => 51,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page']);
    }

    public function test_owner_can_view_trade_details_and_strategy_notes(): void
    {
        $strategyNotes = 'History detail notes '.Str::uuid();
        $strategyName = 'History detail '.Str::uuid();
        $strategyId = DB::table('strategies')->insertGetId([
            'account_id' => $this->accountId,
            'name' => $strategyName,
            'notes' => $strategyNotes,
        ]);
        $tradeId = DB::table('trades')->insertGetId([
            'account_id' => $this->accountId,
            'strategy_id' => $strategyId,
            'external_id' => 'history-detail-'.Str::uuid(),
            'symbol' => 'HISTORYDETAIL',
            'side' => 'short',
            'trading_session' => 'London',
            'opened_at' => Carbon::parse('2026-01-05 10:00:00'),
            'closed_at' => Carbon::parse('2026-01-05 11:00:00'),
            'entry_price' => '1.10000000',
            'exit_price' => '1.09000000',
            'quantity' => '0.25000000',
            'pnl' => '25.00',
            'r_multiple' => '1.2500',
            'status' => 'closed',
        ]);

        $this->getJson('/trades/'.$tradeId)
            ->assertOk()
            ->assertJsonPath('data.id', $tradeId)
            ->assertJsonPath('data.account_id', $this->accountId)
            ->assertJsonPath('data.strategy_name', $strategyName)
            ->assertJsonPath('data.strategy_notes', $strategyNotes)
            ->assertJsonPath('data.symbol', 'HISTORYDETAIL')
            ->assertJsonPath('data.side', 'short')
            ->assertJsonPath('data.quantity', '0.25000000')
            ->assertJsonPath('data.pnl', '25.00')
            ->assertJsonPath('data.r_multiple', '1.2500')
            ->assertJsonPath('data.account_currency', DB::table('accounts')->where('id', $this->accountId)->value('currency'))
            ->assertJsonPath('data.before_image_url', null)
            ->assertJsonPath('data.after_image_url', null)
            ->assertJsonPath('data.account_platform', DB::table('accounts')->where('id', $this->accountId)->value('platform'));
    }

    public function test_trade_notes_can_be_created_read_updated_and_deleted_without_changing_trade_data(): void
    {
        $notes = 'Trade notes '.Str::uuid();
        $payload = $this->validPayload();
        $payload['notes'] = $notes;

        $created = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->assertJsonPath('data.notes', $notes)
            ->json('data');

        $tradeId = $created['id'];
        $tradeFields = [
            'account_id',
            'strategy_id',
            'external_id',
            'symbol',
            'side',
            'trading_session',
            'opened_at',
            'closed_at',
            'entry_price',
            'exit_price',
            'quantity',
            'pnl',
            'r_multiple',
            'status',
        ];
        $before = (array) DB::table('trades')->where('id', $tradeId)->first($tradeFields);

        $this->getJson('/trades/'.$tradeId)
            ->assertOk()
            ->assertJsonPath('data.notes', $notes);

        $updatedNotes = 'Updated notes '.Str::uuid();
        $this->putJson('/trades/'.$tradeId.'/notes', ['notes' => $updatedNotes])
            ->assertOk()
            ->assertJsonPath('data.id', $tradeId)
            ->assertJsonPath('data.notes', $updatedNotes);
        $this->assertSame($before, (array) DB::table('trades')->where('id', $tradeId)->first($tradeFields));
        $this->getJson('/trades/'.$tradeId)
            ->assertOk()
            ->assertJsonPath('data.notes', $updatedNotes);

        $this->deleteJson('/trades/'.$tradeId.'/notes')->assertNoContent();
        $this->assertDatabaseHas('trades', [
            'id' => $tradeId,
            'symbol' => $before['symbol'],
            'entry_price' => $before['entry_price'],
            'exit_price' => $before['exit_price'],
            'quantity' => $before['quantity'],
            'notes' => null,
        ], 'mysql');
        $this->assertDatabaseHas('trades', ['id' => $tradeId], 'mysql');
    }

    public function test_trade_notes_are_optional_independent_and_owner_scoped(): void
    {
        $withoutNotes = $this->postJson('/trades', $this->validPayload())
            ->assertCreated()
            ->assertJsonPath('data.notes', null)
            ->json('data');
        $this->assertDatabaseHas('trades', ['id' => $withoutNotes['id'], 'notes' => null], 'mysql');

        $firstNotes = 'First trade '.Str::uuid();
        $firstPayload = $this->validPayload();
        $firstPayload['notes'] = $firstNotes;
        $firstTrade = $this->postJson('/trades', $firstPayload)->assertCreated()->json('data');

        $secondNotes = 'Second trade '.Str::uuid();
        $secondPayload = $this->validPayload();
        $secondPayload['notes'] = $secondNotes;
        $secondTrade = $this->postJson('/trades', $secondPayload)->assertCreated()->json('data');

        $this->getJson('/trades/'.$firstTrade['id'])->assertJsonPath('data.notes', $firstNotes);
        $this->getJson('/trades/'.$secondTrade['id'])->assertJsonPath('data.notes', $secondNotes);

        $foreignUserId = DB::table('users')->insertGetId([
            'name' => 'Trade note ownership test',
            'email' => 'trade-note-owner-'.Str::uuid().'@example.test',
        ]);
        $foreignAccountId = DB::table('accounts')->insertGetId([
            'user_id' => $foreignUserId,
            'name' => 'Foreign notes account',
            'platform' => 'Test',
        ]);
        $foreignTradeId = DB::table('trades')->insertGetId([
            'account_id' => $foreignAccountId,
            'external_id' => 'foreign-notes-'.Str::uuid(),
            'symbol' => 'NOTEUSD',
            'side' => 'long',
            'trading_session' => 'Test',
            'opened_at' => Carbon::now()->subHour(),
            'entry_price' => '1.10000000',
            'quantity' => '1.00000000',
            'pnl' => '0.00',
            'status' => 'open',
            'notes' => 'Private foreign note',
        ]);

        $this->getJson('/trades/'.$foreignTradeId)->assertNotFound();
        $this->putJson('/trades/'.$foreignTradeId.'/notes', ['notes' => 'Unauthorized update'])->assertNotFound();
        $this->deleteJson('/trades/'.$foreignTradeId.'/notes')->assertNotFound();
        $this->assertDatabaseHas('trades', [
            'id' => $foreignTradeId,
            'notes' => 'Private foreign note',
        ], 'mysql');
    }

    public function test_trade_lifecycle_supports_edit_close_and_reopen_while_preserving_entry_and_notes(): void
    {
        $notes = 'Keep these notes '.Str::uuid();
        $openPayload = $this->validPayload('open');
        $openPayload['notes'] = $notes;
        $open = $this->postJson('/trades', $openPayload)
            ->assertCreated()
            ->json('data');
        $tradeId = $open['id'];
        $original = DB::table('trades')->where('id', $tradeId)->first([
            'opened_at',
            'entry_price',
            'quantity',
            'notes',
        ]);

        $closedPayload = $openPayload;
        $closedPayload['status'] = 'closed';
        $closedPayload['closed_at'] = Carbon::now()->format('Y-m-d\TH:i');
        $closedPayload['exit_price'] = '1.23450000';
        $closedPayload['pnl'] = '25.50';
        $closed = $this->putJson('/trades/'.$tradeId, $closedPayload)
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.exit_price', '1.23450000')
            ->assertJsonPath('data.pnl', '25.50')
            ->json('data');

        $this->assertSame($original->opened_at, DB::table('trades')->where('id', $tradeId)->value('opened_at'));
        $this->assertSame($original->entry_price, DB::table('trades')->where('id', $tradeId)->value('entry_price'));
        $this->assertSame($original->quantity, DB::table('trades')->where('id', $tradeId)->value('quantity'));
        $this->assertSame($notes, DB::table('trades')->where('id', $tradeId)->value('notes'));

        $closedPayload['symbol'] = 'EDITEDUSD';
        $closedPayload['side'] = 'short';
        $this->putJson('/trades/'.$tradeId, $closedPayload)
            ->assertOk()
            ->assertJsonPath('data.symbol', 'EDITEDUSD')
            ->assertJsonPath('data.side', 'short');

        $reopenPayload = $closedPayload;
        $reopenPayload['status'] = 'open';
        unset($reopenPayload['closed_at'], $reopenPayload['exit_price'], $reopenPayload['r_multiple']);
        $this->putJson('/trades/'.$tradeId, $reopenPayload)
            ->assertOk()
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.closed_at', null)
            ->assertJsonPath('data.exit_price', null);

        $invalidPayload = $reopenPayload;
        $invalidPayload['symbol'] = 'MUSTNOTSAVE';
        $invalidPayload['entry_price'] = 'not-a-price';
        $this->putJson('/trades/'.$tradeId, $invalidPayload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['entry_price']);

        $this->assertDatabaseHas('trades', [
            'id' => $tradeId,
            'symbol' => 'EDITEDUSD',
            'entry_price' => $original->entry_price,
            'notes' => $notes,
            'status' => 'open',
            'closed_at' => null,
            'exit_price' => null,
        ], 'mysql');
        $this->assertSame('25.50', DB::table('trades')->where('id', $tradeId)->value('pnl'));
    }

    public function test_owner_trade_summary_updates_after_close_and_delete(): void
    {
        $before = $this->getJson('/trade-summary')->assertOk()->json();

        $openPayload = $this->validPayload('open');
        $open = $this->postJson('/trades', $openPayload)
            ->assertCreated()
            ->json('data');
        $afterCreate = $this->getJson('/trade-summary')->assertOk()->json();
        $this->assertSame($before['total_trades'] + 1, $afterCreate['total_trades']);
        $this->assertSame($before['open_trades'] + 1, $afterCreate['open_trades']);
        $this->assertSame($before['closed_trades'], $afterCreate['closed_trades']);

        $closedPayload = $openPayload;
        $closedPayload['status'] = 'closed';
        $closedPayload['closed_at'] = Carbon::now()->format('Y-m-d\TH:i');
        $closedPayload['exit_price'] = '1.23450000';
        $closedPayload['pnl'] = '12.34';
        $closed = $this->putJson('/trades/'.$open['id'], $closedPayload)
            ->assertOk()
            ->json('data');
        $afterClose = $this->getJson('/trade-summary')->assertOk()->json();
        $this->assertSame($before['total_trades'] + 1, $afterClose['total_trades']);
        $this->assertSame($before['open_trades'], $afterClose['open_trades']);
        $this->assertSame($before['closed_trades'] + 1, $afterClose['closed_trades']);
        $this->assertSame(
            number_format((float) $before['recorded_pnl'] + 12.34, 2, '.', ''),
            $afterClose['recorded_pnl'],
        );

        $this->deleteJson('/trades/'.$closed['id'])->assertNoContent();
        $this->assertSame($before, $this->getJson('/trade-summary')->assertOk()->json());
    }

    public function test_buy_and_sell_creation_persists_and_updates_trade_journal_and_summary(): void
    {
        $summaryBefore = $this->getJson('/trade-summary')->assertOk()->json();
        $cases = [
            ['long', 'BUY'.Str::upper(Str::random(8)), '100.00000000', '110.00000000'],
            ['short', 'SELL'.Str::upper(Str::random(8)), '110.00000000', '100.00000000'],
        ];
        $createdTrades = [];

        foreach ($cases as [$side, $symbol, $entry, $exit]) {
            $payload = $this->validPayload();
            $payload['side'] = $side;
            $payload['symbol'] = $symbol;
            $payload['entry_price'] = $entry;
            $payload['exit_price'] = $exit;
            $payload['quantity'] = '2.00';
            $payload['contract_size'] = '10.00000000';
            $payload['commission'] = '5.00';
            $payload['swap'] = '-2.00';
            $payload['pnl'] = '0.00';

            $trade = $this->postJson('/trades', $payload)
                ->assertCreated()
                ->assertJsonPath('data.side', $side)
                ->assertJsonPath('data.gross_pnl', '200.00')
                ->assertJsonPath('data.pnl', '193.00')
                ->json('data');

            $this->assertDatabaseHas('trades', [
                'id' => $trade['id'],
                'symbol' => $symbol,
                'side' => $side,
                'gross_pnl' => '200.00',
                'pnl' => '193.00',
            ], 'mysql');
            $this->getJson('/trades?search='.urlencode($symbol))
                ->assertOk()
                ->assertJsonPath('total', 1)
                ->assertJsonPath('data.0.id', $trade['id']);
            $createdTrades[] = $trade;
        }

        $summaryAfterCreate = $this->getJson('/trade-summary')->assertOk()->json();
        $this->assertSame($summaryBefore['total_trades'] + 2, $summaryAfterCreate['total_trades']);
        $this->assertSame(
            number_format((float) $summaryBefore['recorded_pnl'] + 386, 2, '.', ''),
            $summaryAfterCreate['recorded_pnl'],
        );

        $trade = $createdTrades[0];
        $updatedPayload = $this->validPayload();
        $updatedPayload['external_id'] = $trade['external_id'];
        $updatedPayload['symbol'] = $trade['symbol'];
        $updatedPayload['side'] = 'short';
        $updatedPayload['entry_price'] = '110.00000000';
        $updatedPayload['exit_price'] = '105.00000000';
        $updatedPayload['quantity'] = '2.00';
        $updatedPayload['contract_size'] = '10.00000000';
        $updatedPayload['commission'] = '1.00';
        $updatedPayload['swap'] = '0.00';
        $updatedPayload['pnl'] = '0.00';
        $updatedPayload['opened_at'] = '2026-03-08T23:30';
        $updatedPayload['closed_at'] = '2026-03-09T00:15';

        $updated = $this->putJson('/trades/'.$trade['id'], $updatedPayload)
            ->assertOk()
            ->assertJsonPath('data.side', 'short')
            ->assertJsonPath('data.pnl', '99.00')
            ->assertJsonPath('data.closed_at', '2026-03-09T00:15')
            ->json('data');
        $this->assertDatabaseHas('trades', [
            'id' => $updated['id'],
            'side' => 'short',
            'closed_at' => '2026-03-09 00:15:00',
            'pnl' => '99.00',
        ], 'mysql');

        foreach ($createdTrades as $created) {
            $this->deleteJson('/trades/'.$created['id'])->assertNoContent();
            $this->assertDatabaseMissing('trades', ['id' => $created['id']], 'mysql');
        }

        $this->assertSame($summaryBefore, $this->getJson('/trade-summary')->assertOk()->json());
    }

    public function test_trade_without_removed_form_fields_defaults_pnl_and_preserves_legacy_values_when_edited(): void
    {
        $payload = $this->validPayload();
        $payload['entry_price'] = '100.00000000';
        $payload['exit_price'] = '110.00000000';
        $payload['quantity'] = '2.00';
        $payload['pnl'] = '0.00';
        $payload['risk_percentage'] = '2.5';

        $created = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->assertJsonPath('data.gross_pnl', '20.00')
            ->assertJsonPath('data.pnl', '20.00')
            ->assertJsonPath('data.risk_percentage', '2.5')
            ->json('data');

        $this->assertDatabaseHas('trades', [
            'id' => $created['id'],
            'contract_size' => '1.00000000',
            'commission' => '0.00',
            'swap' => '0.00',
            'risk_percentage' => '2.5000',
        ], 'mysql');

        DB::table('trades')->where('id', $created['id'])->update([
            'contract_size' => '10.00000000',
            'commission' => '5.00',
            'swap' => '-2.00',
            'risk_amount' => '75.00',
            'setup' => 'Legacy setup',
        ]);

        $payload['risk_percentage'] = '1.5';
        $updated = $this->putJson('/trades/'.$created['id'], $payload)
            ->assertOk()
            ->assertJsonPath('data.gross_pnl', '200.00')
            ->assertJsonPath('data.pnl', '193.00')
            ->assertJsonPath('data.risk_percentage', '1.5')
            ->assertJsonPath('data.contract_size', '10.00000000')
            ->assertJsonPath('data.commission', '5.00')
            ->assertJsonPath('data.swap', '-2.00')
            ->assertJsonPath('data.risk_amount', '75.00')
            ->assertJsonPath('data.setup', 'Legacy setup')
            ->json('data');

        $this->assertDatabaseHas('trades', [
            'id' => $updated['id'],
            'risk_percentage' => '1.5000',
            'contract_size' => '10.00000000',
            'commission' => '5.00',
            'swap' => '-2.00',
            'risk_amount' => '75.00',
            'setup' => 'Legacy setup',
            'gross_pnl' => '200.00',
            'pnl' => '193.00',
        ], 'mysql');

        $this->getJson('/trades/'.$created['id'])
            ->assertOk()
            ->assertJsonPath('data.risk_percentage', '1.5000');
    }

    public function test_manual_account_trade_can_be_created_viewed_edited_and_deleted_without_mt5(): void
    {
        $account = $this->postJson('/accounts', [
            'name' => 'Manual lifecycle '.Str::random(8),
            'currency' => 'USD',
            'starting_balance' => '2500.00',
        ])
            ->assertCreated()
            ->assertJsonPath('data.connection_method', 'manual')
            ->json('data');

        $this->assertDatabaseHas('accounts', [
            'id' => $account['id'],
            'connection_method' => 'manual',
            'platform' => 'Manual',
        ], 'mysql');
        $this->assertDatabaseMissing('mt5_connections', ['account_id' => $account['id']], 'mysql');

        $before = $this->getJson('/trade-summary')->assertOk()->json();
        $payload = $this->validPayload();
        $payload['account_id'] = $account['id'];
        $payload['strategy_id'] = null;
        $payload['symbol'] = 'MNL'.Str::upper(Str::random(6));
        $payload['pnl'] = '15.25';
        $payload['risk_percentage'] = '0.5';

        $trade = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->assertJsonPath('data.pnl', '15.25')
            ->assertJsonPath('data.risk_percentage', '0.5')
            ->json('data');
        $this->assertDatabaseHas('trades', [
            'id' => $trade['id'],
            'account_id' => $account['id'],
            'side' => 'long',
            'pnl' => '15.25',
            'risk_percentage' => '0.5000',
        ], 'mysql');

        $this->getJson('/trades/'.$trade['id'])
            ->assertOk()
            ->assertJsonPath('data.account_id', $account['id'])
            ->assertJsonPath('data.risk_percentage', '0.5000');
        $this->assertSame(
            number_format((float) $before['recorded_pnl'] + 15.25, 2, '.', ''),
            $this->getJson('/trade-summary')->assertOk()->json('recorded_pnl'),
        );

        $payload['external_id'] = $trade['external_id'];
        $payload['side'] = 'short';
        $payload['pnl'] = '-5.00';
        $payload['risk_percentage'] = '2.5';
        $updated = $this->putJson('/trades/'.$trade['id'], $payload)
            ->assertOk()
            ->assertJsonPath('data.side', 'short')
            ->assertJsonPath('data.pnl', '-5.00')
            ->assertJsonPath('data.risk_percentage', '2.5')
            ->json('data');

        $this->assertDatabaseHas('trades', [
            'id' => $updated['id'],
            'account_id' => $account['id'],
            'side' => 'short',
            'pnl' => '-5.00',
            'risk_percentage' => '2.5000',
        ], 'mysql');
        $this->getJson('/trades/'.$trade['id'])
            ->assertOk()
            ->assertJsonPath('data.risk_percentage', '2.5000');

        $this->deleteJson('/trades/'.$trade['id'])->assertNoContent();
        $this->assertDatabaseMissing('trades', ['id' => $trade['id']], 'mysql');
        $this->assertSame($before, $this->getJson('/trade-summary')->assertOk()->json());
    }

    public function test_risk_percentage_rejects_negative_values(): void
    {
        $payload = $this->validPayload();
        $payload['risk_percentage'] = '-0.5';

        $this->postJson('/trades', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['risk_percentage']);
    }

    public function test_trade_pnl_summary_is_grouped_by_account_currency(): void
    {
        $eurAccountId = DB::table('accounts')->insertGetId([
            'user_id' => auth()->id(),
            'name' => 'EUR summary test account',
            'platform' => 'Test',
            'currency' => 'EUR',
        ]);
        DB::table('trades')->insert([
            'account_id' => $eurAccountId,
            'external_id' => 'currency-summary-'.Str::uuid(),
            'symbol' => 'EURUSD',
            'side' => 'long',
            'trading_session' => 'London Session',
            'opened_at' => '2026-01-01 10:00:00',
            'closed_at' => '2026-01-01 11:00:00',
            'entry_price' => '1.10000000',
            'exit_price' => '1.11000000',
            'quantity' => '0.01000000',
            'pnl' => '125.50',
            'status' => 'closed',
        ]);

        $summary = $this->getJson('/trade-summary')->assertOk()->json();
        $reported = collect($summary['recorded_pnl_by_currency'])->keyBy('currency');
        $expectedEur = (string) DB::table('trades')
            ->join('accounts', 'accounts.id', '=', 'trades.account_id')
            ->where('accounts.user_id', auth()->id())
            ->where('accounts.currency', 'EUR')
            ->where('trades.status', 'closed')
            ->sum('trades.pnl');

        $this->assertSame($expectedEur, $reported->get('EUR')['amount']);
        $this->assertArrayHasKey('recorded_pnl', $summary);
    }

    public function test_owner_can_create_edit_and_delete_open_and_closed_trades(): void
    {
        $payload = $this->validPayload('open');
        $created = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.account_id', $this->accountId)
            ->json('data');

        $this->assertDatabaseHas('trades', [
            'id' => $created['id'],
            'account_id' => $this->accountId,
            'status' => 'open',
            'closed_at' => null,
            'exit_price' => null,
        ], 'mysql');

        $newAccountId = DB::table('accounts')->insertGetId([
            'user_id' => auth()->id(),
            'name' => 'Trade move test account',
            'platform' => 'Test',
        ]);
        $closed = $payload;
        $closed['account_id'] = $newAccountId;
        $closed['strategy_id'] = null;
        $closed['status'] = 'closed';
        $closed['closed_at'] = Carbon::now()->format('Y-m-d\TH:i');
        $closed['exit_price'] = '1.23450000';
        $closed['r_multiple'] = '1.2500';
        $closed['pnl'] = '25.50';

        $this->putJson('/trades/'.$created['id'], $closed)
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.account_id', $newAccountId)
            ->assertJsonPath('data.pnl', '25.50');

        $this->deleteJson('/trades/'.$created['id'])->assertNoContent();
        $this->assertDatabaseMissing('trades', ['id' => $created['id']], 'mysql');
    }

    public function test_owner_can_create_manual_trade_without_external_id(): void
    {
        $payload = $this->validPayload();
        unset($payload['external_id']);

        $created = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->assertJsonPath('data.account_id', $this->accountId)
            ->json('data');

        $this->assertMatchesRegularExpression('/^manual-[0-9A-HJKMNP-TV-Z]{26}$/', $created['external_id']);
        $this->assertDatabaseHas('trades', [
            'id' => $created['id'],
            'account_id' => $this->accountId,
            'external_id' => $created['external_id'],
        ], 'mysql');
    }

    public function test_strategy_name_and_description_are_optional_and_reusable_per_account(): void
    {
        $strategyName = 'Custom strategy '.Str::uuid();
        $firstPayload = $this->validPayload();
        unset($firstPayload['strategy_id']);
        $firstPayload['strategy_name'] = $strategyName;
        $firstPayload['strategy_notes'] = 'Wait for a confirmed range break.';

        $first = $this->postJson('/trades', $firstPayload)
            ->assertCreated()
            ->assertJsonPath('data.strategy_name', $strategyName)
            ->assertJsonPath('data.strategy_notes', 'Wait for a confirmed range break.')
            ->json('data');

        $secondPayload = $this->validPayload();
        unset($secondPayload['strategy_id']);
        $secondPayload['strategy_name'] = $strategyName;
        $secondPayload['strategy_notes'] = 'Wait for a confirmed range break.';
        $second = $this->postJson('/trades', $secondPayload)
            ->assertCreated()
            ->assertJsonPath('data.strategy_id', $first['strategy_id'])
            ->json('data');

        $withoutStrategy = $this->validPayload();
        unset($withoutStrategy['strategy_id']);
        $this->postJson('/trades', $withoutStrategy)
            ->assertCreated()
            ->assertJsonPath('data.strategy_id', null);

        $this->assertSame(
            1,
            DB::table('strategies')->where('account_id', $this->accountId)->where('name', $strategyName)->count(),
        );
        $this->assertSame($first['strategy_id'], $second['strategy_id']);

        $withoutDescription = $this->validPayload();
        unset($withoutDescription['strategy_id']);
        $withoutDescription['strategy_name'] = $strategyName;
        $this->postJson('/trades', $withoutDescription)
            ->assertCreated()
            ->assertJsonPath('data.strategy_notes', 'Wait for a confirmed range break.');
        $this->assertDatabaseHas('strategies', [
            'id' => $first['strategy_id'],
            'notes' => 'Wait for a confirmed range break.',
        ], 'mysql');
    }

    public function test_market_condition_and_trend_direction_are_structured_and_validated(): void
    {
        $payload = $this->validPayload();
        $payload['market_condition'] = 'Trending';
        $payload['trend_direction'] = 'Bullish';

        $trending = $this->postJson('/trades', $payload)
            ->assertCreated()
            ->assertJsonPath('data.market_condition', 'Trending')
            ->assertJsonPath('data.trend_direction', 'Bullish')
            ->json('data');
        $this->assertDatabaseHas('trades', [
            'id' => $trending['id'],
            'market_condition' => 'Trending',
            'trend_direction' => 'Bullish',
        ], 'mysql');

        $rangingPayload = $payload;
        $rangingPayload['market_condition'] = 'Ranging';
        $rangingPayload['trend_direction'] = null;
        $this->putJson('/trades/'.$trending['id'], $rangingPayload)
            ->assertOk()
            ->assertJsonPath('data.market_condition', 'Ranging')
            ->assertJsonPath('data.trend_direction', null);
        $this->assertDatabaseHas('trades', [
            'id' => $trending['id'],
            'market_condition' => 'Ranging',
            'trend_direction' => null,
        ], 'mysql');

        $invalidTrending = $this->validPayload();
        $invalidTrending['market_condition'] = 'Trending';
        $this->postJson('/trades', $invalidTrending)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['trend_direction']);

        $invalidRanging = $this->validPayload();
        $invalidRanging['market_condition'] = 'Ranging';
        $invalidRanging['trend_direction'] = 'Bearish';
        $this->postJson('/trades', $invalidRanging)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['trend_direction']);

        $invalidSession = $this->validPayload();
        $invalidSession['trading_session'] = 'Test';
        $this->postJson('/trades', $invalidSession)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['trading_session']);
    }

    public function test_historical_session_value_can_be_preserved_when_editing_a_trade(): void
    {
        $tradeId = DB::table('trades')->insertGetId([
            'account_id' => $this->accountId,
            'external_id' => 'legacy-session-'.Str::uuid(),
            'symbol' => 'LEGACYUSD',
            'side' => 'long',
            'trading_session' => 'Old custom session',
            'opened_at' => Carbon::now()->subHour(),
            'entry_price' => '1.10000000',
            'quantity' => '1.00000000',
            'pnl' => '0.00',
            'status' => 'open',
        ]);
        $payload = $this->validPayload('open');
        $payload['external_id'] = DB::table('trades')->where('id', $tradeId)->value('external_id');
        $payload['trading_session'] = 'Old custom session';
        $payload['market_condition'] = 'Ranging';

        $this->putJson('/trades/'.$tradeId, $payload)
            ->assertOk()
            ->assertJsonPath('data.trading_session', 'Old custom session')
            ->assertJsonPath('data.market_condition', 'Ranging');
    }

    public function test_r_multiple_remains_stored_when_other_trade_fields_are_edited(): void
    {
        $payload = $this->validPayload();
        $payload['r_multiple'] = '1.7500';
        $created = $this->postJson('/trades', $payload)->assertCreated()->json('data');
        unset($payload['r_multiple']);
        $payload['external_id'] = $created['external_id'];
        $payload['symbol'] = 'PRESERVEDR';

        $this->putJson('/trades/'.$created['id'], $payload)
            ->assertOk()
            ->assertJsonPath('data.symbol', 'PRESERVEDR')
            ->assertJsonPath('data.r_multiple', '1.7500');
        $this->assertSame('1.7500', DB::table('trades')->where('id', $created['id'])->value('r_multiple'));
    }

    public function test_trade_images_upload_replace_remove_and_remain_owner_scoped(): void
    {
        Storage::fake('local');
        $imageContents = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rS8AAAAASUVORK5CYII=', true);
        $payload = $this->validPayload();
        unset($payload['strategy_id']);

        $created = $this->post('/trades', [
            ...$payload,
            'before_image' => UploadedFile::fake()->createWithContent('before.png', $imageContents),
        ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('data.after_image_url', null)
            ->json('data');

        $tradeId = $created['id'];
        $beforePath = DB::table('trades')->where('id', $tradeId)->value('before_image_path');
        $this->assertStringStartsWith("trade-attachments/".auth()->id()."/{$tradeId}/", $beforePath);
        Storage::disk('local')->assertExists($beforePath);
        $this->getJson("/trades/{$tradeId}")
            ->assertOk()
            ->assertJsonPath('data.before_image_url', "/trades/{$tradeId}/attachments/before")
            ->assertJsonPath('data.after_image_url', null);
        $this->get("/trades/{$tradeId}/attachments/before")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png');
        $this->get("/trades/{$tradeId}/attachments/after")->assertNotFound();

        $foreignUserId = DB::table('users')->insertGetId([
            'name' => 'Foreign image owner',
            'email' => 'foreign-image-'.Str::uuid().'@example.test',
        ]);
        $foreignAccountId = DB::table('accounts')->insertGetId([
            'user_id' => $foreignUserId,
            'name' => 'Foreign image account',
            'platform' => 'Test',
        ]);
        $foreignTradeId = DB::table('trades')->insertGetId([
            'account_id' => $foreignAccountId,
            'external_id' => 'foreign-image-'.Str::uuid(),
            'symbol' => 'IMAGEUSD',
            'side' => 'long',
            'trading_session' => 'Test',
            'opened_at' => Carbon::now()->subHour(),
            'entry_price' => '1.10000000',
            'quantity' => '1.00000000',
            'pnl' => '0.00',
            'status' => 'open',
            'before_image_path' => null,
        ]);
        $foreignPath = "trade-attachments/{$foreignUserId}/{$foreignTradeId}/private.png";
        DB::table('trades')->where('id', $foreignTradeId)->update(['before_image_path' => $foreignPath]);
        Storage::disk('local')->put($foreignPath, $imageContents);
        $this->get("/trades/{$foreignTradeId}/attachments/before")->assertNotFound();

        $updatePayload = array_merge($payload, [
            'external_id' => $created['external_id'],
            '_method' => 'PUT',
            'before_image' => UploadedFile::fake()->createWithContent('replacement.png', $imageContents),
            'after_image' => UploadedFile::fake()->createWithContent('after.png', $imageContents),
        ]);
        $this->post("/trades/{$tradeId}", $updatePayload, ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('data.after_image_url', "/trades/{$tradeId}/attachments/after");

        $replacementPath = DB::table('trades')->where('id', $tradeId)->value('before_image_path');
        $afterPath = DB::table('trades')->where('id', $tradeId)->value('after_image_path');
        $this->assertNotSame($beforePath, $replacementPath);
        Storage::disk('local')->assertMissing($beforePath);
        Storage::disk('local')->assertExists($replacementPath);
        Storage::disk('local')->assertExists($afterPath);

        $removePayload = array_merge($payload, [
            'external_id' => $created['external_id'],
            '_method' => 'PUT',
            'remove_before_image' => '1',
            'remove_after_image' => '1',
        ]);
        $this->post("/trades/{$tradeId}", $removePayload, ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('data.before_image_url', null)
            ->assertJsonPath('data.after_image_url', null);
        Storage::disk('local')->assertMissing($replacementPath);
        Storage::disk('local')->assertMissing($afterPath);
        $this->get("/trades/{$tradeId}/attachments/before")->assertNotFound();
    }

    public function test_trade_image_validation_rejects_non_images_and_files_over_two_megabytes(): void
    {
        Storage::fake('local');
        $payload = $this->validPayload();
        unset($payload['strategy_id']);

        $this->post('/trades', [
            ...$payload,
            'before_image' => UploadedFile::fake()->createWithContent(
                'unsupported.gif',
                base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', true),
            ),
        ], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['before_image']);

        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rS8AAAAASUVORK5CYII=', true);
        $oversized = UploadedFile::fake()->createWithContent('oversized.png', $png.str_repeat("\0", 2049 * 1024));
        $this->assertGreaterThan(2048 * 1024, $oversized->getSize());
        $this->post('/trades', [
            ...$payload,
            'after_image' => $oversized,
        ], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['after_image']);

        $this->assertSame(20, DB::table('trades')->count());
    }

    public function test_invalid_trade_input_is_rejected_without_writing_a_trade(): void
    {
        $payload = $this->validPayload();
        $payload['side'] = 'diagonal';

        $this->postJson('/trades', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['side']);

        $payload['side'] = 'long';
        $payload['external_id'] = DB::table('trades')->where('account_id', $this->accountId)->value('external_id');
        $this->postJson('/trades', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['external_id']);

        $payload = $this->validPayload();
        $payload['notes'] = str_repeat('n', 10001);
        $this->postJson('/trades', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['notes']);

        $this->assertSame(20, DB::table('trades')->count());
    }

    public function test_lot_size_accepts_hundredths_and_preserves_database_precision(): void
    {
        foreach ([
            '0.01' => '0.01000000',
            '0.02' => '0.02000000',
            '0.10' => '0.10000000',
            '0.50' => '0.50000000',
            '1.00' => '1.00000000',
            '2.35' => '2.35000000',
            '0.25000000' => '0.25000000',
        ] as $quantity => $storedQuantity) {
            $payload = $this->validPayload();
            $payload['quantity'] = $quantity;

            $created = $this->postJson('/trades', $payload)
                ->assertCreated()
                ->assertJsonPath('data.quantity', $quantity)
                ->json('data');

            $this->assertSame(
                $storedQuantity,
                DB::table('trades')->where('id', $created['id'])->value('quantity'),
            );
        }
    }

    public function test_invalid_lot_sizes_are_rejected_with_clear_validation_messages(): void
    {
        foreach ([
            '0.00' => 'The lot size must be at least 0.01.',
            '0.005' => 'The lot size must be at least 0.01.',
            '0.015' => 'The lot size must use increments of 0.01.',
            '2.35000001' => 'The lot size must use increments of 0.01.',
            '2.350000001' => 'The lot size must have no more than 8 decimal places.',
        ] as $quantity => $message) {
            $payload = $this->validPayload();
            $payload['quantity'] = $quantity;

            $this->postJson('/trades', $payload)
                ->assertUnprocessable()
                ->assertJsonPath('errors.quantity.0', $message);
        }
    }

    public function test_account_and_strategy_must_belong_to_the_authenticated_owner(): void
    {
        $foreignUserId = DB::table('users')->insertGetId([
            'name' => 'Trade ownership test',
            'email' => 'trade-owner-'.Str::uuid().'@example.test',
        ]);
        $foreignAccountId = DB::table('accounts')->insertGetId([
            'user_id' => $foreignUserId,
            'name' => 'Ownership test account',
            'platform' => 'Test',
        ]);
        $foreignStrategyId = DB::table('strategies')->insertGetId([
            'account_id' => $foreignAccountId,
            'name' => 'Ownership test strategy',
        ]);
        $foreignTradeId = DB::table('trades')->insertGetId([
            'account_id' => $foreignAccountId,
            'strategy_id' => $foreignStrategyId,
            'external_id' => 'foreign-'.Str::uuid(),
            'symbol' => 'TESTUSD',
            'side' => 'long',
            'trading_session' => 'Test',
            'opened_at' => Carbon::now()->subHour(),
            'entry_price' => '1.10000000',
            'quantity' => '1.00000000',
            'pnl' => '0.00',
            'status' => 'open',
        ]);

        $this->getJson('/trades')
            ->assertOk()
            ->assertJsonMissing(['id' => $foreignTradeId]);
        $ownerTradeCount = DB::table('trades')
            ->whereIn('account_id', DB::table('accounts')->select('id')->where('user_id', auth()->id()))
            ->count();
        $this->getJson('/trade-summary')
            ->assertOk()
            ->assertJsonPath('total_trades', $ownerTradeCount);
        $this->getJson('/trades/'.$foreignTradeId)->assertNotFound();
        $this->putJson('/trades/'.$foreignTradeId, $this->validPayload())->assertNotFound();
        $this->deleteJson('/trades/'.$foreignTradeId)->assertNotFound();

        $foreignAccountPayload = $this->validPayload();
        $foreignAccountPayload['account_id'] = $foreignAccountId;
        $this->postJson('/trades', $foreignAccountPayload)->assertNotFound();

        $foreignStrategyPayload = $this->validPayload();
        $foreignStrategyPayload['strategy_id'] = $foreignStrategyId;
        $this->postJson('/trades', $foreignStrategyPayload)->assertNotFound();
    }

    public function test_trade_endpoints_require_authentication(): void
    {
        auth()->logout();

        $this->getJson('/trades')->assertUnauthorized();
        $this->getJson('/trade-summary')->assertUnauthorized();
        $this->getJson('/trades/1')->assertUnauthorized();
        $this->getJson('/trade-options')->assertUnauthorized();
        $this->postJson('/trades', [])->assertUnauthorized();
        $this->putJson('/trades/1', [])->assertUnauthorized();
        $this->deleteJson('/trades/1')->assertUnauthorized();
        $this->getJson('/trades/1/attachments/before')->assertUnauthorized();
        $this->putJson('/trades/1/notes', ['notes' => 'unauthorized'])->assertUnauthorized();
        $this->deleteJson('/trades/1/notes')->assertUnauthorized();
    }

    private function validPayload(string $status = 'closed'): array
    {
        $openedAt = Carbon::now()->subHour()->format('Y-m-d\TH:i');
        $payload = [
            'account_id' => $this->accountId,
            'strategy_id' => $this->strategyId ?: null,
            'external_id' => 'test-'.Str::uuid(),
            'symbol' => 'TESTUSD',
            'side' => 'long',
            'trading_session' => 'London Session',
            'market_condition' => 'Ranging',
            'trend_direction' => null,
            'opened_at' => $openedAt,
            'entry_price' => '1.12345678',
            'quantity' => '0.25000000',
            'pnl' => '12.34',
            'status' => $status,
        ];

        if ($status === 'closed') {
            $payload['closed_at'] = Carbon::now()->format('Y-m-d\TH:i');
            $payload['exit_price'] = '1.23456789';
            $payload['r_multiple'] = '1.2500';
        }

        return $payload;
    }
}
