import assert from "node:assert/strict";
import test from "node:test";
import { validateRegistrationIdentity } from "./registrationValidation.js";

test("valid username and email are independently accepted", () => {
  assert.deepEqual(
    validateRegistrationIdentity(
      { username: "champ_2026", email: "champ@gmail.com" },
      false
    ),
    {}
  );
});

test("email format errors are assigned only to the email field", () => {
  assert.deepEqual(
    validateRegistrationIdentity(
      { username: "champ_2026", email: "not-an-email" },
      true
    ),
    { email: "Enter a valid email address." }
  );
});

test("username format errors are assigned only to the username field", () => {
  assert.deepEqual(
    validateRegistrationIdentity(
      { username: "ch", email: "champ@gmail.com" },
      false
    ),
    {
      username: "Username must be 3–30 characters. Use letters, numbers, dots, dashes, or underscores."
    }
  );
});
