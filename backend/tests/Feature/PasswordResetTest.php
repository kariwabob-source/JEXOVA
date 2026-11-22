<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use DatabaseTransactions;

    private const GENERIC_STATUS = 'If an account exists for that email, a password reset link has been sent.';

    private User $user;

    private string $email;

    private string $rateLimitKey;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertSame('mysql', config('database.default'));
        $this->assertSame('edgeledger_test', config('database.connections.mysql.database'));
        $this->assertSame('edgeledger_test', DB::selectOne('SELECT DATABASE() AS database_name')->database_name);

        $this->email = 'password-reset-'.bin2hex(random_bytes(6)).'@example.test';
        $this->user = User::query()->create([
            'name' => 'Password Reset Test',
            'email' => $this->email,
            'password_hash' => Hash::make('old-test-password'),
        ]);
        $this->rateLimitKey = hash('sha256', '127.0.0.1');
        RateLimiter::clear($this->rateLimitKey);
        Notification::fake();
    }

    protected function tearDown(): void
    {
        if (isset($this->rateLimitKey)) {
            RateLimiter::clear($this->rateLimitKey);
        }

        parent::tearDown();
    }

    public function test_login_forgot_password_and_reset_pages_are_available(): void
    {
        $this->get('/login')->assertOk();
        $this->get('/forgot-password')->assertOk();
        $this->get(route('password.reset', [
            'token' => 'test-reset-token',
            'email' => $this->email,
        ]))->assertOk();
    }

    public function test_reset_link_requests_use_the_same_response_for_known_and_unknown_emails(): void
    {
        $this->post('/forgot-password', ['email' => $this->email])
            ->assertRedirect()
            ->assertSessionHas('password_reset_status', self::GENERIC_STATUS);

        $this->post('/forgot-password', ['email' => 'unknown-'.bin2hex(random_bytes(6)).'@example.test'])
            ->assertRedirect()
            ->assertSessionHas('password_reset_status', self::GENERIC_STATUS);

        Notification::assertSentTo($this->user, ResetPassword::class);
    }

    public function test_reset_link_is_rate_limited(): void
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post('/forgot-password', [
                'email' => 'unknown-'.bin2hex(random_bytes(6)).'@example.test',
            ])->assertRedirect();
        }

        $this->post('/forgot-password', [
            'email' => 'unknown-'.bin2hex(random_bytes(6)).'@example.test',
        ])->assertTooManyRequests();
    }

    public function test_invalid_reset_link_response_does_not_reveal_if_email_exists(): void
    {
        foreach ([$this->email, 'unknown-'.bin2hex(random_bytes(6)).'@example.test'] as $email) {
            $resetUrl = route('password.reset', ['token' => 'invalid-reset-token', 'email' => $email]);

            $this->from($resetUrl)->post('/reset-password', [
                'token' => 'invalid-reset-token',
                'email' => $email,
                'password' => 'new-test-password',
                'password_confirmation' => 'new-test-password',
            ])->assertRedirect($resetUrl)
                ->assertSessionHasErrors([
                    'email' => 'The password reset link is invalid or has expired.',
                ]);
        }
    }

    public function test_reset_link_changes_password_only_after_confirmation_and_minimum_length_validation(): void
    {
        $this->post('/forgot-password', ['email' => $this->email])
            ->assertRedirect()
            ->assertSessionHas('password_reset_status', self::GENERIC_STATUS);

        $token = null;
        Notification::assertSentTo(
            $this->user,
            ResetPassword::class,
            static function (ResetPassword $notification) use (&$token): bool {
                $token = $notification->token;

                return true;
            },
        );
        $this->assertIsString($token);

        $resetUrl = route('password.reset', ['token' => $token, 'email' => $this->email]);
        $this->get($resetUrl)->assertOk();

        $this->from($resetUrl)->post('/reset-password', [
            'token' => $token,
            'email' => $this->email,
            'password' => 'short',
            'password_confirmation' => 'short',
        ])->assertRedirect($resetUrl)
            ->assertSessionHasErrors(['password']);

        $this->from($resetUrl)->post('/reset-password', [
            'token' => $token,
            'email' => $this->email,
            'password' => 'new-test-password',
            'password_confirmation' => 'different-test-password',
        ])->assertRedirect($resetUrl)
            ->assertSessionHasErrors(['password']);

        $this->from($resetUrl)->post('/reset-password', [
            'token' => $token,
            'email' => $this->email,
            'password' => 'new-test-password',
            'password_confirmation' => 'new-test-password',
        ])->assertRedirect(route('login'))
            ->assertSessionHas('password_reset_status', 'Your password has been reset. You can now sign in.');

        $this->assertTrue(Hash::check('new-test-password', $this->user->fresh()->password_hash));
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => $this->email]);
    }
}
