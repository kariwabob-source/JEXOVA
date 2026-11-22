<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Mt5Connection extends Model
{
    protected $fillable = [
        'user_id',
        'account_id',
        'account_name',
        'token_hash',
        'status',
        'account_login',
        'server',
        'currency',
        'balance',
        'equity',
        'leverage',
        'is_demo',
        'last_sync_at',
        'last_error_code',
    ];

    protected function casts(): array
    {
        return [
            'balance' => 'decimal:8',
            'equity' => 'decimal:8',
            'is_demo' => 'boolean',
            'last_sync_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function pairings(): HasMany
    {
        return $this->hasMany(Mt5Pairing::class, 'connection_id');
    }

    public function syncRuns(): HasMany
    {
        return $this->hasMany(Mt5SyncRun::class, 'connection_id');
    }

    public function latestSyncRun(): HasOne
    {
        return $this->hasOne(Mt5SyncRun::class, 'connection_id')->latestOfMany();
    }
}
