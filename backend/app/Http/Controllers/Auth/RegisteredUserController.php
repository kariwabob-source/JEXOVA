<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\VerificationMailConfiguration;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;

class RegisteredUserController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $request->merge([
            'first_name' => $this->trimString($request->input('first_name')),
            'last_name' => $this->trimString($request->input('last_name')),
            'username' => is_string($request->input('username'))
                ? strtolower(trim($request->input('username')))
                : $request->input('username'),
            'email' => is_string($request->input('email'))
                ? strtolower(trim($request->input('email')))
                : $request->input('email'),
            'country' => $this->trimString($request->input('country')),
            'phone_number' => $this->trimString($request->input('phone_number')) ?: null,
        ]);

        $safeInput = $request->only([
            'first_name',
            'last_name',
            'username',
            'email',
            'country',
            'phone_number',
        ]);

        $validator = Validator::make($request->all(), [
            'first_name' => ['required', 'string', 'max:120'],
            'last_name' => ['required', 'string', 'max:120'],
            'username' => ['required', 'string', 'regex:/^[A-Za-z0-9._-]{3,30}$/', 'unique:users,username'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', Password::min(8), 'confirmed'],
            'country' => ['required', 'string', 'max:100'],
            'phone_number' => ['nullable', 'string', 'max:30'],
            'terms_accepted' => ['accepted'],
            'privacy_accepted' => ['accepted'],
        ], [
            'username.regex' => 'Use 3–30 letters, numbers, dots, dashes, or underscores.',
            'username.unique' => 'That username is already taken.',
            'email.unique' => 'An account with this email already exists.',
            'terms_accepted.accepted' => 'You must accept the Terms & Conditions.',
            'privacy_accepted.accepted' => 'You must accept the Privacy Policy.',
        ]);

        $validator->after(function ($validator) use ($request): void {
            $firstName = $request->input('first_name');
            $lastName = $request->input('last_name');
            $fullName = trim(
                (is_string($firstName) ? $firstName : '')
                .' '
                .(is_string($lastName) ? $lastName : ''),
            );
            $characterCount = preg_match_all('/./us', $fullName);

            if ($characterCount !== false && $characterCount > 120) {
                $validator->errors()->add('last_name', 'First and last name must total no more than 120 characters.');
            }
        });

        if ($validator->fails()) {
            return back()
                ->withErrors($validator)
                ->withInput($safeInput);
        }

        if (! VerificationMailConfiguration::canDeliver()) {
            return back()
                ->withErrors([
                    'registration' => 'Registration is unavailable because email verification delivery is not configured.',
                ])
                ->withInput($safeInput);
        }

        $validated = $validator->validated();

        try {
            $user = DB::transaction(function () use ($validated): User {
                $user = User::query()->create([
                    'name' => trim($validated['first_name'].' '.$validated['last_name']),
                    'first_name' => $validated['first_name'],
                    'last_name' => $validated['last_name'],
                    'username' => $validated['username'],
                    'email' => $validated['email'],
                    'password_hash' => Hash::make($validated['password']),
                    'country' => $validated['country'],
                    'phone_number' => $validated['phone_number'] ?: null,
                    'terms_accepted_at' => now(),
                    'privacy_accepted_at' => now(),
                ]);

                $user->sendEmailVerificationNotification();

                return $user;
            });
        } catch (UniqueConstraintViolationException $exception) {
            $message = strtolower($exception->getMessage());

            if (str_contains($message, 'uq_users_email')) {
                return back()
                    ->withErrors(['email' => 'An account with this email already exists.'])
                    ->withInput($safeInput);
            }

            if (str_contains($message, 'uq_users_username')) {
                return back()
                    ->withErrors(['username' => 'That username is already taken.'])
                    ->withInput($safeInput);
            }

            throw $exception;
        } catch (TransportExceptionInterface $exception) {
            report($exception);

            return back()
                ->withErrors([
                    'registration' => 'The verification email could not be sent, so the account was not created. Please try again later.',
                ])
                ->withInput($safeInput);
        }

        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return redirect()->route('verification.notice');
    }

    private function trimString(mixed $value): mixed
    {
        return is_string($value) ? trim($value) : $value;
    }
}
