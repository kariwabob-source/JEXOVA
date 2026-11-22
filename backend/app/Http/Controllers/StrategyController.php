<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\Strategy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class StrategyController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $account = $this->ownedAccount($request);
        $validated = $request->validate([
            'name' => [
                'required',
                'string',
                'max:120',
                Rule::unique('strategies', 'name')->where(fn ($query) => $query->where('account_id', $account->getKey())),
            ],
            'notes' => ['nullable', 'string', 'max:10000'],
        ]);

        $strategy = $account->strategies()->create($validated);

        return response()->json(['data' => $this->strategyData($strategy)], 201);
    }

    public function update(Request $request, Strategy $strategy): JsonResponse
    {
        $this->ownedStrategy($request, $strategy);
        $validated = $request->validate([
            'name' => [
                'required',
                'string',
                'max:120',
                Rule::unique('strategies', 'name')
                    ->where(fn ($query) => $query->where('account_id', $strategy->account_id))
                    ->ignore($strategy->getKey()),
            ],
            'notes' => ['nullable', 'string', 'max:10000'],
        ]);

        $strategy->update($validated);

        return response()->json(['data' => $this->strategyData($strategy)]);
    }

    public function destroy(Request $request, Strategy $strategy): Response
    {
        $this->ownedStrategy($request, $strategy);
        $strategy->trades()->update(['strategy_id' => null]);
        $strategy->delete();

        return response()->noContent();
    }

    private function ownedAccount(Request $request): Account
    {
        $validated = $request->validate(['account_id' => ['required', 'integer']]);

        return $request->user()->accounts()->findOrFail($validated['account_id']);
    }

    private function ownedStrategy(Request $request, Strategy $strategy): void
    {
        abort_unless(
            $strategy->account()->where('user_id', $request->user()->getKey())->exists(),
            404,
        );
    }

    private function strategyData(Strategy $strategy): array
    {
        return [
            'id' => $strategy->getKey(),
            'account_id' => $strategy->account_id,
            'name' => $strategy->name,
            'notes' => $strategy->notes,
        ];
    }
}
