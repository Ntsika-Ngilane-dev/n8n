import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionCookie,
  createSessionCookie,
  getSessionUser,
} from "./auth-session.js";
import { normalizeFeedback, sendFeedbackToWorkflow } from "./feedback.js";

const user = {
  id: "google-sub-123",
  name: "Avery Student",
  email: "avery@example.com",
  role: "student",
};

function requestWithCookie(cookie) {
  return { headers: { cookie } };
}

test("Google session cookie is signed, readable, and cleared on sign-out", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  try {
    const cookie = createSessionCookie(user);
    const cookieValue = cookie.split(";")[0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.deepEqual(getSessionUser(requestWithCookie(cookieValue)), user);
    assert.equal(getSessionUser(requestWithCookie(`${cookieValue}tampered`)), null);
    assert.match(clearSessionCookie(), /Max-Age=0/);
  } finally {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});

test("feedback uses verified session identity, not client-supplied identity", () => {
  assert.deepEqual(normalizeFeedback(user, {
    studentName: "Someone Else",
    email: "other@example.com",
    courseName: "  Intro to UX  ",
    rating: "2",
    feedbackMessage: "  Please add more examples.  ",
  }), {
    studentName: "Avery Student",
    email: "avery@example.com",
    courseName: "Intro to UX",
    rating: 2,
    feedbackMessage: "Please add more examples.",
  });
});

test("feedback validation rejects a missing course or out-of-range rating", () => {
  assert.throws(
    () => normalizeFeedback(user, { courseName: "", rating: 6, feedbackMessage: "Needs work" }),
    { status: 400 },
  );
});

test("feedback is sent to the configured n8n workflow", async () => {
  const originalUrl = process.env.N8N_WEBHOOK_URL;
  const originalFetch = globalThis.fetch;
  const feedback = normalizeFeedback(user, {
    courseName: "Intro to UX",
    rating: 4,
    feedbackMessage: "Helpful course.",
  });
  let request;
  process.env.N8N_WEBHOOK_URL = "https://n8n.example/webhook/student-feedback";
  globalThis.fetch = async (...args) => {
    request = args;
    return { ok: true };
  };
  try {
    await sendFeedbackToWorkflow(feedback);
    assert.equal(request[0], process.env.N8N_WEBHOOK_URL);
    assert.equal(request[1].method, "POST");
    assert.deepEqual(JSON.parse(request[1].body), feedback);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.N8N_WEBHOOK_URL;
    else process.env.N8N_WEBHOOK_URL = originalUrl;
  }
});
