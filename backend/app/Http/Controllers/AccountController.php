<?php

namespace App\Http\Controllers;

use App\Models\Account;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AccountController extends Controller
{
    private const ACCOUNT_TYPES = ['demo', 'real', 'prop_firm'];

    private const PROP_FIRM_PHASES = [
        'Evaluation Phase 1',
        'Evaluation Phase 2',
        'Funded',
        'Instant Funding',
    ];

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'account_type' => ['nullable', Rule::in(self::ACCOUNT_TYPES)],
            'broker_name' => ['nullable', 'string', 'max:120'],
            'platform' => ['nullable', 'string', 'max:80'],
            'connection_method' => ['sometimes', Rule::in(['manual'])],
            'currency' => ['required', 'string', 'regex:/\A[A-Z]{3}\z/'],
            'starting_balance' => [
                'required',
                'numeric',
                'between:0,9999999999999.99',
                'decimal:0,2',
            ],
            'account_reference' => ['nullable', 'string', 'max:120'],
            'nominal_account_size' => [
                'nullable',
                Rule::prohibitedIf($request->input('account_type') !== 'prop_firm'),
                'numeric',
                'between:0.01,9999999999999.99',
                'decimal:0,2',
            ],
            'challenge_phase' => [
                'nullable',
                Rule::prohibitedIf($request->input('account_type') !== 'prop_firm'),
                Rule::in(self::PROP_FIRM_PHASES),
            ],
        ]);

        $validated['platform'] = trim((string) ($validated['platform'] ?? '')) ?: 'Manual';
        $validated['connection_method'] = 'manual';
        $account = $request->user()->accounts()->create($validated);

        return response()->json([
            'data' => $this->accountData($account),
        ], 201);
    }

    private function accountData(Account $account): array
    {
        return [
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
            'connection_status' => 'manual',
            'synchronization_status' => null,
        ];
    }
}