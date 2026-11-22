<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Mt5SyncRun extends Model
{
    protected $fillable = [
        'connection_id',
        'requested_by',
        'status',
        'orders_count',
        'deals_count',
        'positions_count',
        'requested_at',
        'started_at',
        'claimed_at',
        'finished_at',
        'error_code',
    ];

    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'started_at' => 'datetime',
            'claimed_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(Mt5Connection::class, 'connection_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }
}
