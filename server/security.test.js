import assert from "node:assert/strict";
import test from "node:test";
import { cleanText, validateEmail } from "./security.js";

test("email validation requires an expected format", () => {
  assert.equal(validateEmail("student@example.com"), true);
  assert.equal(validateEmail("not-an-email"), false);
});

test("cleanText trims and limits user-provided text", () => {
  assert.equal(cleanText("  Course  "), "Course");
  assert.equal(cleanText("feedback", 4), "feed");
});
