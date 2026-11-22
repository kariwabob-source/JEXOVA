<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#090b10">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>JEXOVA</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23e0b15a'/%3E%3Cpath d='M6 22l6-8 5 4 9-10' fill='none' stroke='%231a1408' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    @vite('src/main.jsx', 'build')
</head>
<body>
    <div
        id="root"
        data-authenticated="{{ auth()->check() ? 'true' : 'false' }}"
        data-auth-error="{{ $errors->first('auth') }}"
        data-old-email="{{ old('email') }}"
        data-registration-errors='@json($errors->getMessages())'
        data-old-registration='@json(old())'
        data-password-reset-status="{{ session('password_reset_status') }}"
        data-password-reset-error="{{ $errors->first() }}"
        data-reset-email="{{ old('email', request('email')) }}"
        data-reset-token="{{ $resetToken ?? '' }}"
        data-verification-status="{{ session('verification_status') }}"
        data-verification-error="{{ $errors->first('verification') }}"
    ></div>
</body>
</html>
