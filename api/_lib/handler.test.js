import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest } from "./handler.js";
import { createSessionCookie } from "../../server/auth-session.js";
import healthRoute from "../health.js";
import firebaseAuthRoute from "../auth/firebase.js";
import sessionRoute from "../auth/me.js";
import signoutRoute from "../auth/signout.js";
import feedbackRoute from "../feedback.js";

test("Vercel exposes the app API as explicit serverless function routes", () => {
  for (const route of [
    healthRoute,
    firebaseAuthRoute,
    sessionRoute,
    signoutRoute,
    feedbackRoute,
  ]) {
    assert.equal(route, handleApiRequest);
  }
});

async function request(path, method = "GET", headers = {}, body) {
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = JSON.parse(value);
    },
  };
  await handleApiRequest({
    url: path,
    method,
    headers,
    body,
  }, response);
  return response;
}

test("serverless health and signed-out session routes need no database", async () => {
  assert.deepEqual((await request("/api/health")).body, { status: "ok" });
  assert.deepEqual((await request("/api/auth/me")).body, { user: null });
});

test("serverless feedback requires sign-in and account creation stays with Firebase", async () => {
  const feedback = await request("/api/feedback", "POST", {}, {
    courseName: "UX",
    rating: 5,
    feedbackMessage: "Helpful",
  });
  assert.equal(feedback.statusCode, 401);

  const originalApiKey = process.env.FIREBASE_API_KEY;
  delete process.env.FIREBASE_API_KEY;
  let credential;
  try {
    credential = await request("/api/auth/firebase", "POST", {}, {
      credential: "valid-looking-token",
    });
  } finally {
    if (originalApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalApiKey;
  }
  assert.equal(credential.statusCode, 503);
  const signup = await request("/api/auth/signup", "POST", {}, {});
  assert.equal(signup.statusCode, 404);
});

test("serverless feedback sends verified student data to n8n without a database", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalWebhook = process.env.N8N_WEBHOOK_URL;
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.N8N_WEBHOOK_URL = "https://n8n.example/webhook/student-feedback";
  const user = {
    id: "google-sub-123",
    name: "Avery Student",
    email: "avery@example.com",
    role: "student",
  };
  const cookie = createSessionCookie(user).split(";")[0];
  let submitted;
  globalThis.fetch = async (_url, options) => {
    submitted = JSON.parse(options.body);
    return { ok: true };
  };

  try {
    const response = await request("/api/feedback", "POST", { cookie }, {
      courseName: "Introduction to UX",
      rating: 5,
      feedbackMessage: "The exercises were helpful.",
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(submitted, {
      studentName: user.name,
      email: user.email,
      courseName: "Introduction to UX",
      rating: 5,
      feedbackMessage: "The exercises were helpful.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalWebhook === undefined) delete process.env.N8N_WEBHOOK_URL;
    else process.env.N8N_WEBHOOK_URL = originalWebhook;
  }
});
