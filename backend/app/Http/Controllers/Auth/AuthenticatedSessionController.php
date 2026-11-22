<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;
use Illuminate\View\View;

class AuthenticatedSessionController extends Controller
{
    public function create(): View
    {
        return view('edgeledger');
    }

    public function store(Request $request): RedirectResponse
    {
        $validator = Validator::make($request->only('email', 'password'), [
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return back()
                ->withErrors(['auth' => 'Unable to log in with those credentials.'])
                ->withInput($request->only('email'));
        }

        $credentials = [
            'email' => mb_strtolower(trim($request->string('email')->toString())),
            'password' => $request->input('password'),
        ];

        if (! Auth::guard('web')->attempt($credentials)) {
            return back()
                ->withErrors(['auth' => 'Unable to log in with those credentials.'])
                ->withInput($request->only('email'));
        }

        $request->session()->regenerate();
        $user = Auth::guard('web')->user();

        if ($user !== null && ! $user->hasVerifiedEmail()) {
            return redirect()->route('verification.notice');
        }

        return redirect()->intended('/');
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/login');
    }
}
