<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Trade extends Model
{
    protected $fillable = [
        'strategy_id',
        'external_id',
        'symbol',
        'side',
        'trading_session',
        'market_condition',
        'trend_direction',
        'opened_at',
        'closed_at',
        'entry_price',
        'exit_price',
        'quantity',
        'contract_size',
        'commission',
        'swap',
        'gross_pnl',
        'risk_amount',
        'risk_percentage',
        'stop_loss',
        'take_profit',
        'timeframe',
        'setup',
        'trade_source',
        'lessons_learned',
        'emotional_state',
        'pnl',
        'r_multiple',
        'status',
        'notes',
        'before_image_path',
        'after_image_path',
    ];

    protected function casts(): array
    {
        return [
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function strategy(): BelongsTo
    {
        return $this->belongsTo(Strategy::class);
    }
}
