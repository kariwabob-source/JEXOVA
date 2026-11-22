<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Illuminate\Auth\Notifications\VerifyEmail;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertSame('mysql', config('database.default'));
        $this->assertSame(
            'edgeledger_test',
            config('database.connections.'.config('database.default').'.database'),
        );
        $this->assertSame('edgeledger_test', DB::connection()->getDatabaseName());

        Notification::fake();
    }

    public function test_registration_creates_a_hashed_unverified_user_and_stores_acceptance_timestamps(): void
    {
        $data = $this->registrationData();

        $this->post('/register', $data)
            ->assertRedirect('/email/verify')
            ->assertSessionHasNoErrors();

        $user = User::query()->where('email', $data['email'])->firstOrFail();

        $this->assertSame('Ada Lovelace', $user->name);
        $this->assertSame($data['first_name'], $user->first_name);
        $this->assertSame($data['last_name'], $user->last_name);
        $this->assertSame(strtolower($data['username']), $user->username);
        $this->assertSame(strtolower($data['email']), $user->email);
        $this->assertSame($data['country'], $user->country);
        $this->assertSame($data['phone_number'], $user->phone_number);
        $this->assertTrue(Hash::check($data['password'], $user->password_hash));
        $this->assertNotSame($data['password'], $user->password_hash);
        $this->assertNotNull($user->terms_accepted_at);
        $this->assertNotNull($user->privacy_accepted_at);
        $this->assertNull($user->email_verified_at);
        $this->assertAuthenticatedAs($user);

        Notification::assertSentTo($user, VerifyEmail::class);
        $this->get('/')->assertRedirect('/email/verify');
    }

    public function test_new_unverified_user_cannot_access_protected_trading_routes(): void
    {
        $data = $this->registrationData();

        $this->post('/register', $data)
            ->assertRedirect('/email/verify')
            ->assertSessionHasNoErrors();

        $user = User::query()->where('email', strtolower($data['email']))->firstOrFail();
        $this->assertNull($user->email_verified_at);
        $this->assertAuthenticatedAs($user);

        $this->post('/logout')->assertRedirect('/login');
        $this->post('/login', [
            'email' => $data['email'],
            'password' => $data['password'],
        ])->assertRedirect('/email/verify');
        $this->assertAuthenticatedAs($user);

        $this->get('/')->assertRedirect('/email/verify');
        $this->getJson('/trades')->assertForbidden();
        $this->getJson('/trade-options')->assertForbidden();
        $this->getJson('/trade-summary')->assertForbidden();
        $this->postJson('/trades', [])->assertForbidden();
        $this->putJson('/trades/1', [])->assertForbidden();
        $this->deleteJson('/trades/1')->assertForbidden();
    }

    public function test_new_user_can_refresh_log_out_log_back_in_and_only_access_their_own_trade(): void
    {
        $data = $this->registrationData();

        $this->post('/register', $data)
            ->assertRedirect('/email/verify')
            ->assertSessionHasNoErrors();

        $user = User::query()->where('email', strtolower($data['email']))->firstOrFail();
        $this->assertSame('edgeledger_test', DB::connection()->getDatabaseName());
        $this->assertTrue(Hash::check($data['password'], $user->password_hash));

        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(30),
            [
                'id' => $user->getKey(),
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );
        $this->get($verificationUrl)->assertRedirect('/');
        $this->get('/')->assertOk();

        $this->post('/logout')->assertRedirect('/login');
        $this->get('/')->assertRedirect('/login');
        $this->post('/login', [
            'email' => $data['email'],
            'password' => $data['password'],
        ])->assertRedirect('/');
        $this->get('/')->assertOk();

        $accountId = DB::table('accounts')->insertGetId([
            'user_id' => $user->getKey(),
            'name' => 'Registration E2E account',
            'platform' => 'Test',
            'currency' => 'USD',
            'starting_balance' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $trade = $this->postJson('/trades', [
            'account_id' => $accountId,
            'symbol' => 'E2EUSD',
            'side' => 'long',
            'trading_session' => 'London Session',
            'market_condition' => 'Ranging',
            'opened_at' => now()->subHour()->format('Y-m-d\TH:i'),
            'entry_price' => '1.10000000',
            'quantity' => '0.10000000',
            'pnl' => '0.00',
            'status' => 'open',
            'notes' => 'Registration persistence test',
        ])->assertCreated()->json('data');

        $this->assertDatabaseHas('trades', [
            'id' => $trade['id'],
            'account_id' => $accountId,
            'symbol' => 'E2EUSD',
        ], 'mysql');

        $otherUserSuffix = bin2hex(random_bytes(5));
        $otherUser = User::query()->create([
            'name' => 'Second registration E2E user',
            'username' => 'second-'.$otherUserSuffix,
            'email' => 'second-'.$otherUserSuffix.'@example.test',
            'password_hash' => Hash::make('temporary-test-password'),
        ]);
        $otherUser->email_verified_at = now();
        $otherUser->save();
        $this->actingAs($otherUser);

        $this->getJson('/trades/'.$trade['id'])->assertNotFound();
        $this->putJson('/trades/'.$trade['id'].'/notes', ['notes' => 'Unauthorized'])->assertNotFound();
        $this->deleteJson('/trades/'.$trade['id'])->assertNotFound();
        $this->assertSame('edgeledger_test', DB::connection()->getDatabaseName());
    }

    public function test_registration_stores_the_submitted_email_after_trimming_and_lowercasing(): void
    {
        $data = $this->registrationData();
        $data['username'] = 'champ_2026-'.bin2hex(random_bytes(5));
        $submittedEmail = '  Champ+'.bin2hex(random_bytes(5)).'@Example.TEST  ';
        $data['email'] = $submittedEmail;

        $this->post('/register', $data)
            ->assertRedirect('/email/verify')
            ->assertSessionHasNoErrors();

        $user = User::query()->where('username', $data['username'])->firstOrFail();

        $this->assertSame(strtolower(trim($submittedEmail)), $user->email);
    }

    public function test_unverified_user_can_correct_email_and_receive_a_new_verification_notification(): void
    {
        $user = $this->createUnverifiedUser();
        $submittedEmail = '  Corrected+'.bin2hex(random_bytes(5)).'@Example.TEST  ';

        $this->actingAs($user)
            ->from('/email/verify')
            ->post('/email/update', ['email' => $submittedEmail])
            ->assertRedirect('/email/verify')
            ->assertSessionHasNoErrors()
            ->assertSessionHas(
                'verification_status',
                'A verification email has been sent to the updated address.',
            );

        $this->assertSame(strtolower(trim($submittedEmail)), $user->fresh()->email);
        $this->assertNull($user->fresh()->email_verified_at);
        Notification::assertSentTo($user, VerifyEmail::class);
    }

    public function test_unverified_user_cannot_change_email_to_another_accounts_email(): void
    {
        $user = $this->createUnverifiedUser();
        $existing = $this->createUnverifiedUser();
        $originalEmail = $user->email;

        $this->actingAs($user)
            ->from('/email/verify')
            ->post('/email/update', ['email' => $existing->email])
            ->assertRedirect('/email/verify')
            ->assertSessionHasErrors(['email']);

        $this->assertSame($originalEmail, $user->fresh()->email);
        Notification::assertNothingSent();
    }

    public function test_verified_user_cannot_change_email_through_verification_flow(): void
    {
        $user = $this->createUnverifiedUser();
        $user->email_verified_at = now();
        $user->save();
        $originalEmail = $user->email;

        $this->actingAs($user)
            ->post('/email/update', ['email' => 'replacement@example.test'])
            ->assertForbidden();

        $this->assertSame($originalEmail, $user->fresh()->email);
    }

    public function test_verification_enables_dashboard_access_and_subsequent_login(): void
    {
        $data = $this->registrationData();
        $this->post('/register', $data)->assertRedirect('/email/verify');

        $user = User::query()->where('email', strtolower($data['email']))->firstOrFail();
        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(30),
            [
                'id' => $user->getKey(),
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );

        $this->get($verificationUrl)->assertRedirect('/');
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->get('/')->assertOk();
        $this->getJson('/trades')->assertOk();

        $this->post('/logout')->assertRedirect('/login');
        $this->post('/login', [
            'email' => $data['email'],
            'password' => $data['password'],
        ])->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
    }

    public function test_legacy_user_without_a_username_must_verify_before_access(): void
    {
        $email = 'legacy-'.bin2hex(random_bytes(5)).'@example.test';
        $user = User::query()->create([
            'name' => 'Legacy Login Test',
            'email' => $email,
            'password_hash' => Hash::make('legacy-test-password'),
        ]);

        $this->assertNull($user->username);
        $this->assertNull($user->email_verified_at);

        $this->post('/login', [
            'email' => $email,
            'password' => 'legacy-test-password',
        ])->assertRedirect('/email/verify');

        $this->assertAuthenticatedAs($user);
        $this->get('/')->assertRedirect('/email/verify');
        $this->getJson('/trades')->assertForbidden();

        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(30),
            [
                'id' => $user->getKey(),
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );

        $this->get($verificationUrl)->assertRedirect('/');
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->get('/')->assertOk();
    }

    public function test_expired_verification_link_cannot_verify_user(): void
    {
        $user = $this->createUnverifiedUser();
        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->subMinute(),
            [
                'id' => $user->getKey(),
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );

        $this->get($verificationUrl)->assertRedirect('/login');

        $this->actingAs($user)
            ->get($verificationUrl)
            ->assertForbidden();

        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_verification_link_requires_authentication_and_a_valid_signature(): void
    {
        $user = $this->createUnverifiedUser();
        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(30),
            [
                'id' => $user->getKey(),
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );

        $this->get($verificationUrl)->assertRedirect('/login');

        $tamperedUrl = str_replace('signature=', 'signature=invalid', $verificationUrl);
        $this->actingAs($user)
            ->get($tamperedUrl)
            ->assertForbidden();

        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_user_cannot_verify_another_users_account_with_their_signed_link(): void
    {
        $userA = $this->createUnverifiedUser();
        $userB = $this->createUnverifiedUser();
        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(30),
            [
                'id' => $userB->getKey(),
                'hash' => sha1($userB->getEmailForVerification()),
            ],
        );

        $this->actingAs($userA)
            ->get($verificationUrl)
            ->assertForbidden();

        $this->assertNull($userA->fresh()->email_verified_at);
        $this->assertNull($userB->fresh()->email_verified_at);
    }

    public function test_existing_passwordless_email_cannot_be_claimed_or_modified(): void
    {
        $legacyUser = DB::table('users')
            ->whereNotNull('email')
            ->whereNull('password_hash')
            ->first();

        $this->assertNotNull($legacyUser);
        $data = $this->registrationData((string) $legacyUser->email);

        $this->from('/register')->post('/register', $data)
            ->assertRedirect('/register')
            ->assertSessionHasErrors(['email']);

        $unchangedUser = DB::table('users')->where('id', $legacyUser->id)->first();
        $this->assertSame($legacyUser->name, $unchangedUser->name);
        $this->assertSame($legacyUser->email, $unchangedUser->email);
        $this->assertSame($legacyUser->password_hash, $unchangedUser->password_hash);
    }

    public function test_duplicate_username_is_rejected(): void
    {
        $existing = User::query()->create([
            'name' => 'Existing Registration Test',
            'first_name' => 'Existing',
            'last_name' => 'User',
            'username' => 'taken-'.bin2hex(random_bytes(5)),
            'email' => 'existing-'.bin2hex(random_bytes(5)).'@example.test',
            'password_hash' => Hash::make('temporary-test-password'),
            'country' => 'Canada',
            'terms_accepted_at' => now(),
            'privacy_accepted_at' => now(),
        ]);
        $data = $this->registrationData();
        $data['username'] = $existing->username;

        $this->from('/register')->post('/register', $data)
            ->assertRedirect('/register')
            ->assertSessionHasErrors(['username']);

        $this->assertSame(1, User::query()->where('username', $existing->username)->count());
    }

    public function test_registration_fails_closed_when_email_delivery_is_log_only(): void
    {
        $this->app->detectEnvironment(static fn () => 'local');
        config(['mail.default' => 'log']);
        $data = $this->registrationData();
        $csrfToken = bin2hex(random_bytes(20));
        $data['_token'] = $csrfToken;

        $this->withSession(['_token' => $csrfToken])
            ->from('/register')->post('/register', $data)
            ->assertRedirect('/register')
            ->assertSessionHasErrors(['registration']);

        $this->assertDatabaseMissing('users', ['email' => strtolower($data['email'])]);
    }

    public function test_required_fields_password_confirmation_and_policy_acceptance_are_validated(): void
    {
        $data = $this->registrationData();
        $data['first_name'] = '';
        $data['country'] = '';
        $data['password'] = 'short';
        $data['password_confirmation'] = 'different';
        unset($data['terms_accepted'], $data['privacy_accepted']);

        $this->from('/register')->post('/register', $data)
            ->assertRedirect('/register')
            ->assertSessionHasErrors([
                'first_name',
                'country',
                'password',
                'terms_accepted',
                'privacy_accepted',
            ]);

        $response = $this->get('/register')
            ->assertOk()
            ->assertSee('data-registration-errors', false)
            ->assertSee('data-old-registration', false);
        $this->assertStringNotContainsString($data['password'], $response->getContent());

        $confirmationData = $this->registrationData();
        $confirmationData['password_confirmation'] = 'not-the-same-password';

        $this->from('/register')->post('/register', $confirmationData)
            ->assertRedirect('/register')
            ->assertSessionHasErrors(['password']);
    }

    private function registrationData(?string $email = null): array
    {
        $suffix = bin2hex(random_bytes(5));

        return [
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
            'username' => 'ada-'.$suffix,
            'email' => $email ?? 'ada-'.$suffix.'@example.test',
            'password' => 'Secure-test-password-2026!',
            'password_confirmation' => 'Secure-test-password-2026!',
            'country' => 'United Kingdom',
            'phone_number' => '+44 20 0000 0000',
            'terms_accepted' => '1',
            'privacy_accepted' => '1',
        ];
    }

    private function createUnverifiedUser(array $attributes = []): User
    {
        $suffix = bin2hex(random_bytes(5));

        return User::query()->create(array_merge([
            'name' => 'Registration Correction Test',
            'first_name' => 'Registration',
            'last_name' => 'Correction',
            'username' => 'correction-'.$suffix,
            'email' => 'correction-'.$suffix.'@example.test',
            'password_hash' => Hash::make('temporary-test-password'),
            'country' => 'Canada',
            'terms_accepted_at' => now(),
            'privacy_accepted_at' => now(),
        ], $attributes));
    }
}
