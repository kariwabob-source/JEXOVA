export function validateRegistrationIdentity(fields, emailTypeMismatch) {
  const errors = {};

  if (!fields.username.trim()) {
    errors.username = "Choose a username.";
  } else if (!/^[a-zA-Z0-9._-]{3,30}$/.test(fields.username.trim())) {
    errors.username = "Username must be 3–30 characters. Use letters, numbers, dots, dashes, or underscores.";
  }

  if (!fields.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (emailTypeMismatch) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}
