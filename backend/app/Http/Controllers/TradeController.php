<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\Strategy;
use App\Models\Trade;
use App\Models\User;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use RuntimeException;
use Throwable;

class TradeController extends Controller
{
    private const TRADING_SESSIONS = [
        'Asian Session',
        'London Session',
        'New York Session',
        'Sydney Session',
    ];

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:80'],
            'instrument' => ['nullable', 'string', 'max:32'],
            'status' => ['nullable', Rule::in(['open', 'closed'])],
            'side' => ['nullable', Rule::in(['long', 'short'])],
            'strategy_id' => ['nullable', 'integer', 'min:1'],
            'from_date' => ['nullable', 'date_format:Y-m-d'],
            'to_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from_date'],
            'outcome' => ['nullable', Rule::in(['winning', 'losing', 'open'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $sortableColumns = [
            'trade_date' => 'opened_at',
            'instrument' => 'symbol',
            'direction' => 'side',
            'lot_size' => 'quantity',
            'r_multiple' => 'r_multiple',
            'pnl' => 'pnl',
            'status' => 'status',
        ];
        $requestedSort = $request->query('sort');
        $sortColumn = is_string($requestedSort) && isset($sortableColumns[$requestedSort])
            ? $sortableColumns[$requestedSort]
            : 'opened_at';
        $requestedDirection = $request->query('direction');
        $sortDirection = is_string($requestedDirection)
            && in_array(strtolower($requestedDirection), ['asc', 'desc'], true)
                ? strtolower($requestedDirection)
                : 'desc';

        $trades = $this->ownedTradesQuery($request->user())
            ->with(['strategy', 'account'])
            ->when($filters['status'] ?? null, fn (Builder $query, string $status) => $query->where('status', $status))
            ->when($filters['side'] ?? null, fn (Builder $query, string $side) => $query->where('side', $side))
            ->when($filters['strategy_id'] ?? null, fn (Builder $query, int $strategyId) => $query->where('strategy_id', $strategyId))
            ->when($filters['from_date'] ?? null, fn (Builder $query, string $fromDate) => $query->whereDate('opened_at', '>=', $fromDate))
            ->when($filters['to_date'] ?? null, fn (Builder $query, string $toDate) => $query->whereDate('opened_at', '<=', $toDate))
            ->when($filters['instrument'] ?? null, fn (Builder $query, string $instrument) => $query->where('symbol', 'like', "%{$instrument}%"))
            ->when($filters['outcome'] ?? null, function (Builder $query, string $outcome): void {
                if ($outcome === 'open') {
                    $query->where('status', 'open');

                    return;
                }

                $query->where('status', 'closed')
                    ->where('pnl', $outcome === 'winning' ? '>' : '<', 0);
            })
            ->when($filters['search'] ?? null, function (Builder $query, string $search): void {
                $query->where(function (Builder $query) use ($search): void {
                    $query->where('symbol', 'like', "%{$search}%")
                        ->orWhere('external_id', 'like', "%{$search}%")
                        ->orWhereHas('strategy', fn (Builder $strategy) => $strategy->where('name', 'like', "%{$search}%"));
                });
            })
            ->orderBy($sortColumn, $sortDirection)
            ->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 10);

        $trades->through(fn (Trade $trade): array => $this->tradeData($trade));

        return response()->json($trades);
    }

    public function summary(Request $request): JsonResponse
    {
        $summary = $this->ownedTradesQuery($request->user())
            ->selectRaw('COUNT(*) AS total_trades')
            ->selectRaw("SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_trades")
            ->selectRaw("SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_trades")
            ->selectRaw('COALESCE(SUM(CASE WHEN status = \'closed\' THEN pnl ELSE 0 END), 0.00) AS recorded_pnl')
            ->first();
        $recordedPnlByCurrency = $request->user()->accounts()
            ->leftJoin('trades', function ($join): void {
                $join->on('trades.account_id', '=', 'accounts.id')
                    ->where('trades.status', '=', 'closed');
            })
            ->select('accounts.currency')
            ->selectRaw('COALESCE(SUM(trades.pnl), 0.00) AS amount')
            ->groupBy('accounts.currency')
            ->orderBy('accounts.currency')
            ->get()
            ->map(fn ($total): array => [
                'currency' => strtoupper($total->currency),
                'amount' => (string) $total->amount,
            ]);

        return response()->json([
            'total_trades' => (int) $summary->total_trades,
            'open_trades' => (int) $summary->open_trades,
            'closed_trades' => (int) $summary->closed_trades,
            'recorded_pnl' => (string) $summary->recorded_pnl,
            'recorded_pnl_by_currency' => $recordedPnlByCurrency,
        ]);
    }

    public function show(Request $request, int $trade): JsonResponse
    {
        $record = $this->ownedTrade($request->user(), $trade)->load(['account', 'strategy']);
        $data = $this->tradeData($record, true);
        $data['account_name'] = $record->account->name;
        $data['account_platform'] = $record->account->platform;
        $data['account_currency'] = $record->account->currency;

        return response()->json(['data' => $data]);
    }

    public function options(Request $request): JsonResponse
    {
        $accounts = $request->user()->accounts()
            ->with(['strategies', 'mt5Connection.latestSyncRun'])
            ->orderBy('name')
            ->get();

        return response()->json([
            'accounts' => $accounts->map(fn (Account $account): array => [
                'id' => $account->getKey(),
                'name' => $account->name,
                'account_type' => $account->account_type,
                'broker_name' => $account->broker_name,
                'platform' => $account->platform,
                'connection_method' => $account->connection_method,
                'currency' => $account->currency,
                'starting_balance' => $account->starting_balance,
                'nominal_account_size' => $account->nominal_account_size,
                'challenge_phase' => $account->challenge_phase,
                'connection_status' => $this->accountConnectionStatus($account),
                'synchronization_status' => $account->connection_method === 'mt5'
                    ? ($account->mt5Connection?->latestSyncRun?->status ?? 'not_synced')
                    : null,
            ]),
            'strategies' => $accounts->flatMap(
                fn (Account $account) => $account->strategies->map(fn (Strategy $strategy): array => [
                    'id' => $strategy->getKey(),
                    'account_id' => $account->getKey(),
                    'name' => $strategy->name,
                    'notes' => $strategy->notes,
                ]),
            )->values(),
        ]);
    }

    private function accountConnectionStatus(Account $account): string
    {
        if ($account->connection_method !== 'mt5') {
            return 'manual';
        }

        $connection = $account->mt5Connection;
        if ($connection === null) {
            return 'unavailable';
        }

        if ($connection->status === 'connected'
            && $connection->updated_at?->lt(now()->subSeconds(60))) {
            return 'disconnected';
        }

        return $connection->status;
    }

    public function store(Request $request): JsonResponse
    {
        $account = $this->ownedAccount($request->user(), $request->input('account_id'));
        $data = $this->validatedTrade($request, $account);
        $notes = $request->validate([
            'notes' => ['nullable', 'string', 'max:10000'],
        ])['notes'] ?? null;
        unset($data['account_id'], $data['before_image'], $data['after_image'], $data['remove_before_image'], $data['remove_after_image']);

        $newPaths = [];
        $oldPaths = [];

        try {
            $trade = DB::transaction(function () use ($request, $account, &$data, $notes, &$newPaths, &$oldPaths): Trade {
                $this->resolveStrategySelection($account, $data);
                $trade = $account->trades()->create([...$data, 'notes' => $notes]);
                [$newPaths, $oldPaths] = $this->syncTradeAttachments($request, $trade, $request->user()->getKey());
                $trade->save();

                return $trade->load(['strategy', 'account']);
            });
        } catch (Throwable $exception) {
            $this->deleteAttachmentPaths($newPaths);
            throw $exception;
        }

        $this->deleteAttachmentPaths($oldPaths);

        return response()->json(['data' => $this->tradeData($trade, true)], 201);
    }

    public function showAttachment(Request $request, int $trade, string $kind): \Symfony\Component\HttpFoundation\BinaryFileResponse
    {
        $record = $this->ownedTrade($request->user(), $trade);
        $column = match ($kind) {
            'before' => 'before_image_path',
            'after' => 'after_image_path',
            default => abort(404),
        };
        $path = $record->{$column};
        $disk = Storage::disk('local');

        abort_if($path === null || ! $disk->exists($path), 404);

        return response()->file($disk->path($path), [
            'Content-Type' => $disk->mimeType($path) ?? 'application/octet-stream',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Disposition' => 'inline',
        ]);
    }

    public function updateNotes(Request $request, int $trade): JsonResponse
    {
        $record = $this->ownedTrade($request->user(), $trade);
        $validated = $request->validate([
            'notes' => ['present', 'nullable', 'string', 'max:10000'],
        ]);
        $record->notes = $validated['notes'];
        $record->save();

        return response()->json([
            'data' => [
                'id' => $record->getKey(),
                'notes' => $record->notes,
            ],
        ]);
    }

    public function destroyNotes(Request $request, int $trade): Response
    {
        $record = $this->ownedTrade($request->user(), $trade);
        $record->notes = null;
        $record->save();

        return response()->noContent();
    }

    public function update(Request $request, int $trade): JsonResponse
    {
        $record = $this->ownedTrade($request->user(), $trade);
        $account = $this->ownedAccount($request->user(), $request->input('account_id'));
        $data = $this->validatedTrade($request, $account, $record);
        unset($data['account_id'], $data['before_image'], $data['after_image'], $data['remove_before_image'], $data['remove_after_image']);
        $newPaths = [];
        $oldPaths = [];

        try {
            $record = DB::transaction(function () use ($request, $account, $record, &$data, &$newPaths, &$oldPaths): Trade {
                $this->resolveStrategySelection($account, $data);
                $record->fill($data);
                $record->account()->associate($account);
                $record->save();
                [$newPaths, $oldPaths] = $this->syncTradeAttachments($request, $record, $request->user()->getKey());
                $record->save();

                return $record->load(['strategy', 'account']);
            });
        } catch (Throwable $exception) {
            $this->deleteAttachmentPaths($newPaths);
            throw $exception;
        }

        $this->deleteAttachmentPaths($oldPaths);

        return response()->json(['data' => $this->tradeData($record)]);
    }

    public function destroy(Request $request, int $trade): Response
    {
        $record = $this->ownedTrade($request->user(), $trade);
        $paths = array_filter([$record->before_image_path, $record->after_image_path]);
        $record->delete();
        $this->deleteAttachmentPaths($paths);

        return response()->noContent();
    }

    private function validatedTrade(Request $request, Account $account, ?Trade $trade = null): array
    {
        $externalIdRule = Rule::unique('trades', 'external_id')->where('account_id', $account->getKey());
        if ($trade !== null) {
            $externalIdRule->ignore($trade->getKey());
        }
        $allowedSessions = self::TRADING_SESSIONS;
        if ($trade !== null && ! in_array($trade->trading_session, $allowedSessions, true)) {
            $allowedSessions[] = $trade->trading_session;
        }

        $validated = $request->validate([
            'account_id' => ['required', 'integer'],
            'strategy_id' => ['nullable', 'integer'],
            'strategy_name' => ['nullable', 'required_with:strategy_notes', 'string', 'max:120'],
            'strategy_notes' => ['nullable', 'string', 'max:10000'],
            'external_id' => [
                Rule::requiredIf($trade !== null),
                'nullable',
                'string',
                'max:80',
                $externalIdRule,
            ],
            'symbol' => ['required', 'string', 'max:32'],
            'side' => ['required', Rule::in(['long', 'short'])],
            'trading_session' => ['required', 'string', 'max:40', Rule::in($allowedSessions)],
            'market_condition' => ['required', Rule::in(['Trending', 'Ranging'])],
            'trend_direction' => [
                Rule::requiredIf($request->input('market_condition') === 'Trending'),
                Rule::prohibitedIf($request->input('market_condition') === 'Ranging'),
                'nullable',
                Rule::in(['Bullish', 'Bearish']),
            ],
            'status' => ['required', Rule::in(['open', 'closed'])],
            'opened_at' => ['required', 'date_format:Y-m-d\TH:i'],
            'closed_at' => [
                Rule::requiredIf($request->input('status') === 'closed'),
                Rule::prohibitedIf($request->input('status') === 'open'),
                'nullable',
                'date_format:Y-m-d\TH:i',
                'after_or_equal:opened_at',
            ],
            'entry_price' => ['required', 'numeric', 'between:0.00000001,9999999999.99999999', 'decimal:0,8'],
            'exit_price' => [
                Rule::requiredIf($request->input('status') === 'closed'),
                Rule::prohibitedIf($request->input('status') === 'open'),
                'nullable',
                'numeric',
                'between:0.00000001,9999999999.99999999',
                'decimal:0,8',
            ],
            'quantity' => [
                'required',
                static function (string $attribute, mixed $value, Closure $fail): void {
                    if (! is_string($value) && ! is_int($value)) {
                        $fail('The lot size must be provided as a decimal value.');

                        return;
                    }

                    if (! preg_match('/\A\d+(?:\.\d{1,8})?\z/', $value)) {
                        $fail('The lot size must have no more than 8 decimal places.');

                        return;
                    }

                    [$integer, $fraction] = array_pad(explode('.', $value, 2), 2, '');
                    $integer = ltrim($integer, '0') ?: '0';

                    if (
                        strlen($integer) > 10
                        || (strlen($integer) === 10 && strcmp($integer, '9999999999') > 0)
                    ) {
                        $fail('The lot size must not exceed 9,999,999,999.99.');

                        return;
                    }

                    if ($integer === '0' && (int) str_pad(substr($fraction, 0, 2), 2, '0') < 1) {
                        $fail('The lot size must be at least 0.01.');

                        return;
                    }

                    if (rtrim(substr($fraction, 2), '0') !== '') {
                        $fail('The lot size must use increments of 0.01.');
                    }
                },
            ],
            'contract_size' => ['nullable', 'numeric', 'between:0.00000001,9999999999.99999999', 'decimal:0,8'],
            'commission' => ['nullable', 'numeric', 'between:-9999999999999.99,9999999999999.99', 'decimal:0,2'],
            'swap' => ['nullable', 'numeric', 'between:-9999999999999.99,9999999999999.99', 'decimal:0,2'],
            'risk_amount' => ['nullable', 'numeric', 'between:0,9999999999999.99', 'decimal:0,2'],
            'risk_percentage' => ['nullable', 'numeric', 'between:0,999999.9999', 'decimal:0,4'],
            'stop_loss' => ['nullable', 'numeric', 'between:0.00000001,9999999999.99999999', 'decimal:0,8'],
            'take_profit' => ['nullable', 'numeric', 'between:0.00000001,9999999999.99999999', 'decimal:0,8'],
            'timeframe' => ['nullable', 'string', 'max:32'],
            'setup' => ['nullable', 'string', 'max:120'],
            'trade_source' => ['nullable', Rule::in(['manual', 'imported'])],
            'lessons_learned' => ['nullable', 'string', 'max:10000'],
            'emotional_state' => ['nullable', 'string', 'max:40'],
            'pnl' => ['required', 'numeric', 'between:-9999999999999.99,9999999999999.99', 'decimal:0,2'],
            'r_multiple' => [
                'nullable',
                Rule::prohibitedIf($request->input('status') === 'open'),
                'numeric',
                'between:-999999.9999,999999.9999',
                'decimal:0,4',
            ],
            'before_image' => [
                'nullable',
                'image',
                'mimes:png,jpg,jpeg',
                'max:2048',
                Rule::prohibitedIf($request->boolean('remove_before_image')),
            ],
            'after_image' => [
                'nullable',
                'image',
                'mimes:png,jpg,jpeg',
                'max:2048',
                Rule::prohibitedIf($request->boolean('remove_after_image')),
            ],
            'remove_before_image' => ['sometimes', 'boolean'],
            'remove_after_image' => ['sometimes', 'boolean'],
        ]);

        if (isset($validated['strategy_id'])) {
            $account->strategies()->findOrFail($validated['strategy_id']);
        }

        $validated['opened_at'] = str_replace('T', ' ', $validated['opened_at']).':00';
        $validated['closed_at'] = isset($validated['closed_at'])
            ? str_replace('T', ' ', $validated['closed_at']).':00'
            : null;
        $validated['strategy_id'] = $validated['strategy_id'] ?? null;
        $validated['trend_direction'] = $validated['market_condition'] === 'Ranging'
            ? null
            : ($validated['trend_direction'] ?? null);
        $validated['exit_price'] = $validated['exit_price'] ?? null;
        $validated['r_multiple'] = $validated['r_multiple'] ?? $trade?->r_multiple;
        $validated['external_id'] = $validated['external_id'] ?? 'manual-'.Str::ulid();
        $validated['contract_size'] = $validated['contract_size'] ?? $trade?->contract_size ?? 1;
        $validated['commission'] = $validated['commission'] ?? $trade?->commission ?? 0;
        $validated['swap'] = $validated['swap'] ?? $trade?->swap ?? 0;
        $validated['trade_source'] = $validated['trade_source'] ?? 'manual';

        if (
            $validated['status'] === 'closed'
            && $validated['exit_price'] !== null
            && $validated['quantity'] !== null
        ) {
            $direction = $validated['side'] === 'long' ? 1 : -1;
            $grossPnl = (
                ((float) $validated['exit_price'] - (float) $validated['entry_price']) * $direction
                * (float) $validated['quantity']
                * (float) $validated['contract_size']
            );
            $validated['gross_pnl'] = number_format(round($grossPnl, 2), 2, '.', '');
            if (abs((float) $validated['pnl']) < 0.005) {
                $validated['pnl'] = number_format(
                    round($grossPnl - (float) $validated['commission'] + (float) $validated['swap'], 2),
                    2,
                    '.',
                    '',
                );
            }
        } elseif ($validated['status'] === 'open') {
            $validated['gross_pnl'] = null;
        }

        return $validated;
    }

    private function resolveStrategySelection(Account $account, array &$data): void
    {
        $name = trim((string) ($data['strategy_name'] ?? ''));
        if ($name !== '') {
            $notes = $data['strategy_notes'] ?? null;
            $strategy = $account->strategies()->firstOrCreate(
                ['name' => $name],
                ['notes' => $notes],
            );

            if (array_key_exists('strategy_notes', $data) && $strategy->notes !== $notes) {
                $strategy->notes = $notes;
                $strategy->save();
            }

            $data['strategy_id'] = $strategy->getKey();
        } elseif (array_key_exists('strategy_name', $data)) {
            $data['strategy_id'] = null;
        }

        unset($data['strategy_name'], $data['strategy_notes']);
    }

    private function syncTradeAttachments(Request $request, Trade $trade, int $userId): array
    {
        $newPaths = [];
        $oldPaths = [];

        try {
            foreach ([
                ['upload' => 'before_image', 'remove' => 'remove_before_image', 'column' => 'before_image_path'],
                ['upload' => 'after_image', 'remove' => 'remove_after_image', 'column' => 'after_image_path'],
            ] as $attachment) {
                $currentPath = $trade->{$attachment['column']};

                if ($request->hasFile($attachment['upload'])) {
                    $path = $request->file($attachment['upload'])->store(
                        "trade-attachments/{$userId}/{$trade->getKey()}",
                        'local',
                    );
                    if ($path === false) {
                        throw new RuntimeException('The trade image could not be stored.');
                    }

                    $newPaths[] = $path;
                    if ($currentPath !== null) {
                        $oldPaths[] = $currentPath;
                    }
                    $trade->{$attachment['column']} = $path;
                } elseif ($request->boolean($attachment['remove']) && $currentPath !== null) {
                    $oldPaths[] = $currentPath;
                    $trade->{$attachment['column']} = null;
                }
            }
        } catch (Throwable $exception) {
            $this->deleteAttachmentPaths($newPaths);
            throw $exception;
        }

        return [$newPaths, $oldPaths];
    }

    private function deleteAttachmentPaths(array $paths): void
    {
        if ($paths === []) {
            return;
        }

        $disk = Storage::disk('local');
        foreach (array_unique($paths) as $path) {
            if (! $disk->delete($path)) {
                Log::warning('A private trade attachment could not be removed.', ['path' => $path]);
            }
        }
    }

    private function ownedAccount(User $user, mixed $accountId): Account
    {
        $request = validator(
            ['account_id' => $accountId],
            ['account_id' => ['required', 'integer']],
        )->validate();

        return $user->accounts()->findOrFail($request['account_id']);
    }

    private function ownedTrade(User $user, int $tradeId): Trade
    {
        return Trade::query()
            ->whereKey($tradeId)
            ->whereHas('account', fn (Builder $query) => $query->where('user_id', $user->getKey()))
            ->firstOrFail();
    }

    private function ownedTradesQuery(User $user): Builder
    {
        return Trade::query()
            ->whereHas('account', fn (Builder $query) => $query->where('user_id', $user->getKey()));
    }

    private function tradeData(Trade $trade, bool $includeNotes = false): array
    {
        $data = [
            'id' => $trade->getKey(),
            'account_id' => $trade->account_id,
            'strategy_id' => $trade->strategy_id,
            'external_id' => $trade->external_id,
            'symbol' => $trade->symbol,
            'side' => $trade->side,
            'trading_session' => $trade->trading_session,
            'market_condition' => $trade->market_condition,
            'trend_direction' => $trade->trend_direction,
            'opened_at' => $trade->opened_at?->format('Y-m-d\TH:i'),
            'closed_at' => $trade->closed_at?->format('Y-m-d\TH:i'),
            'entry_price' => $trade->entry_price,
            'exit_price' => $trade->exit_price,
            'quantity' => $trade->quantity,
            'contract_size' => $trade->contract_size,
            'commission' => $trade->commission,
            'swap' => $trade->swap,
            'gross_pnl' => $trade->gross_pnl,
            'risk_amount' => $trade->risk_amount,
            'risk_percentage' => $trade->risk_percentage,
            'stop_loss' => $trade->stop_loss,
            'take_profit' => $trade->take_profit,
            'timeframe' => $trade->timeframe,
            'setup' => $trade->setup,
            'trade_source' => $trade->trade_source,
            'lessons_learned' => $trade->lessons_learned,
            'emotional_state' => $trade->emotional_state,
            'pnl' => $trade->pnl,
            'account_currency' => $trade->account?->currency,
            'r_multiple' => $trade->r_multiple,
            'status' => $trade->status,
            'strategy_name' => $trade->strategy?->name,
            'strategy_notes' => $trade->strategy?->notes,
            'before_image_url' => $trade->before_image_path === null ? null : "/trades/{$trade->getKey()}/attachments/before",
            'after_image_url' => $trade->after_image_path === null ? null : "/trades/{$trade->getKey()}/attachments/after",
            'created_at' => $trade->created_at?->toIso8601String(),
            'updated_at' => $trade->updated_at?->toIso8601String(),
        ];

        if ($includeNotes) {
            $data['notes'] = $trade->notes;
        }

        return $data;
    }
}
