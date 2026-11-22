<?php

namespace App\Support;

final class VerificationMailConfiguration
{
    public static function canDeliver(): bool
    {
        if (app()->environment('testing')) {
            return true;
        }

        $mailer = config('mail.default');
        $transport = config('mail.mailers.'.$mailer.'.transport', $mailer);

        if (in_array($transport, ['log', 'array'], true)) {
            return false;
        }

        if ($transport === 'smtp') {
            return filled(config('mail.mailers.smtp.host'))
                && filled(config('mail.mailers.smtp.port'));
        }

        return filled($transport);
    }
}
