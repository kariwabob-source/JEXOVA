<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    private const TEST_PASSWORD = 'temporary-edgeledger-test-password';

    private int $userId;

    private string $email;

    private mixed $originalPasswordHash;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertSame('edgeledger_test', config('database.connections.'.config('database.default').'.database'));
        $this->assertSame('edgeledger_test', DB::connection()->getDatabaseName());

        $user = DB::table('users')->whereNotNull('email')->first();
        $this->assertNotNull($user);

        $this->userId = (int) $user->id;
        $this->email = (string) $user->email;
        $this->originalPasswordHash = $user->password_hash;

        DB::table('users')->where('id', $this->userId)->update([
            'password_hash' => Hash::make(self::TEST_PASSWORD),
        ]);

        RateLimiter::clear(md5('login'.$this->rateLimitKey()));
    }

    protected function tearDown(): void
    {
        if (isset($this->userId)) {
            DB::table('users')->where('id', $this->userId)->update([
                'password_hash' => $this->originalPasswordHash,
            ]);
        }

        if (isset($this->email)) {
            RateLimiter::clear(md5('login'.$this->rateLimitKey()));
        }

        parent::tearDown();
    }

    public function test_existing_user_can_log_in_and_session_id_and_csrf_token_rotate(): void
    {
        $this->get('/login')->assertOk();
        $session = $this->app['session']->driver();
        $oldSessionId = $session->getId();
        $oldCsrfToken = $session->token();

        $this->post('/login', [
            'email' => $this->email,
            'password' => self::TEST_PASSWORD,
        ])->assertRedirect('/');

        $this->assertNotSame($oldSessionId, $session->getId());
        $this->assertNotSame($oldCsrfToken, $session->token());
        $this->get('/')->assertOk();
    }

    public function test_incorrect_password_returns_generic_authentication_error(): void
    {
        $this->from('/login')->post('/login', [
            'email' => $this->email,
            'password' => 'incorrect-test-password',
        ])->assertRedirect('/login')
            ->assertSessionHasErrors([
                'auth' => 'Unable to log in with those credentials.',
            ]);
    }

    public function test_missing_credentials_return_the_same_generic_error(): void
    {
        $this->from('/login')->post('/login', [])
            ->assertRedirect('/login')
            ->assertSessionHasErrors([
                'auth' => 'Unable to log in with those credentials.',
            ]);
    }

    public function test_login_is_rate_limited_after_five_attempts(): void
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->from('/login')->post('/login', [
                'email' => $this->email,
                'password' => 'incorrect-test-password',
            ])->assertRedirect('/login');
        }

        $this->post('/login', [
            'email' => $this->email,
            'password' => 'incorrect-test-password',
        ])->assertTooManyRequests();
    }

    public function test_logout_invalidates_the_session_and_requires_authentication_again(): void
    {
        $user = User::query()->findOrFail($this->userId);
        $this->actingAs($user);

        $this->post('/logout')->assertRedirect('/login');

        $this->get('/')->assertRedirect('/login');
    }

    public function test_unauthenticated_user_cannot_access_the_journal_and_login_page_has_csrf_token(): void
    {
        $this->get('/')->assertRedirect('/login');

        $this->get('/login')
            ->assertOk()
            ->assertSee('name="csrf-token"', false)
            ->assertSee('/build/assets/main-', false);
    }

    public function test_user_account_relationship_is_owner_scoped(): void
    {
        $user = User::query()->findOrFail($this->userId);

        $this->assertSame(
            DB::table('accounts')->where('user_id', $this->userId)->count(),
            $user->accounts()->count(),
        );
    }

    private function rateLimitKey(): string
    {
        return hash('sha256', mb_strtolower(trim($this->email)).'|127.0.0.1');
    }
}
