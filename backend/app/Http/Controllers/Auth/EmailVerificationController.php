<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\VerificationMailConfiguration;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Auth\EmailVerificationRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;

class EmailVerificationController extends Controller
{
    public function verify(EmailVerificationRequest $request): RedirectResponse
    {
        $user = $request->user();

        $request->fulfill();

        return redirect()->route('dashboard')->with(
            'verification_status',
            'Your email address has been verified.',
        );
    }

    public function resend(Request $request): RedirectResponse
    {
        $user = $request->user();

        if ($user->hasVerifiedEmail()) {
            return redirect()->route('dashboard');
        }

        if (! VerificationMailConfiguration::canDeliver()) {
            return back()->withErrors([
                'verification' => 'Email verification delivery is not configured. Contact support before continuing.',
            ]);
        }

        try {
            $user->sendEmailVerificationNotification();
        } catch (TransportExceptionInterface $exception) {
            report($exception);

            return back()->withErrors([
                'verification' => 'The verification email could not be sent. Please try again later.',
            ]);
        }

        return back()->with('verification_status', 'A new verification email has been sent.');
    }

    public function updateEmail(Request $request): RedirectResponse
    {
        $user = $request->user();

        abort_if($user->hasVerifiedEmail(), 403);

        $email = $request->input('email');
        $request->merge([
            'email' => is_string($email) ? strtolower(trim($email)) : $email,
        ]);

        $validated = $request->validate([
            'email' => [
                'required',
                'string',
                'email',
                'max:255',
                Rule::unique('users', 'email')->ignore($user->getKey()),
            ],
        ]);

        if (! VerificationMailConfiguration::canDeliver()) {
            return back()->withErrors([
                'verification' => 'Email verification delivery is not configured. Contact support before continuing.',
            ])->withInput();
        }

        try {
            $user->email = $validated['email'];
            $user->save();
            $user->sendEmailVerificationNotification();
        } catch (UniqueConstraintViolationException $exception) {
            return back()
                ->withErrors(['email' => 'An account with this email already exists.'])
                ->withInput();
        } catch (TransportExceptionInterface $exception) {
            report($exception);

            return back()->withErrors([
                'verification' => 'The verification email could not be sent. Please try again later.',
            ])->withInput();
        }

        return back()->with('verification_status', 'A verification email has been sent to the updated address.');
    }
}
