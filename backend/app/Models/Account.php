<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Account extends Model
{
    protected $hidden = [
        'account_reference',
    ];

    protected $fillable = [
        'name',
        'account_type',
        'broker_name',
        'platform',
        'connection_method',
        'currency',
        'starting_balance',
        'account_reference',
        'nominal_account_size',
        'challenge_phase',
    ];

    protected function casts(): array
    {
        return [
            'starting_balance' => 'decimal:2',
            'account_reference' => 'encrypted',
            'nominal_account_size' => 'decimal:2',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function strategies(): HasMany
    {
        return $this->hasMany(Strategy::class);
    }

    public function trades(): HasMany
    {
        return $this->hasMany(Trade::class);
    }

    public function mt5Connection(): HasOne
    {
        return $this->hasOne(Mt5Connection::class);
    }
}
