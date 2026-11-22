<?php

namespace App\Http\Middleware;

use App\Models\Mt5Connection;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateMt5Connector
{
    public const CONNECTION_ATTRIBUTE = 'mt5_connection';

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        if (! is_string($token) || ! preg_match('/\A[a-f0-9]{64}\z/i', $token)) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $connection = Mt5Connection::query()
            ->where('token_hash', hash('sha256', strtolower($token)))
            ->first();

        if ($connection === null) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (! $connection->user?->hasVerifiedEmail()) {
            return response()->json(['message' => 'Verify your email address to continue.'], 403);
        }

        $request->attributes->set(self::CONNECTION_ATTRIBUTE, $connection);

        return $next($request);
    }
}
