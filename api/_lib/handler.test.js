import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest } from "./handler.js";
import { createSessionCookie } from "../../server/auth-session.js";
import healthRoute from "../health.js";
import firebaseAuthRoute from "../auth/firebase.js";
import sessionRoute from "../auth/me.js";
import signoutRoute from "../auth/signout.js";
import feedbackRoute from "../feedback.js";
import adminFeedbackRoute from "../admin/feedback.js";

test("Vercel exposes the app API as explicit serverless function routes", () => {
  for (const route of [
    healthRoute,
    firebaseAuthRoute,
    sessionRoute,
    signoutRoute,
    feedbackRoute,
    adminFeedbackRoute,
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
  const originalAdmins = process.env.ADMIN_EMAILS;
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
      studentId: user.id,
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
    if (originalAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdmins;
  }
});

test("serverless feedback explains how to fix an n8n webhook 404", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalWebhook = process.env.N8N_WEBHOOK_URL;
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.N8N_WEBHOOK_URL = "https://n8n.example/webhook/student-feedback";
  const cookie = createSessionCookie({
    id: "google-sub-123",
    name: "Avery Student",
    email: "avery@example.com",
  }).split(";")[0];
  globalThis.fetch = async () => ({ ok: false, status: 404 });

  try {
    const response = await request("/api/feedback", "POST", { cookie }, {
      courseName: "Introduction to UX",
      rating: 5,
      feedbackMessage: "The exercises were helpful.",
    });
    assert.equal(response.statusCode, 502);
    assert.match(response.body.message, /N8N_WEBHOOK_URL.*active Production URL/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalWebhook === undefined) delete process.env.N8N_WEBHOOK_URL;
    else process.env.N8N_WEBHOOK_URL = originalWebhook;
  }
});

test("admin feedback endpoint denies students and returns sheet rows only to allowlisted admins", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalWebhook = process.env.N8N_ADMIN_WEBHOOK_URL;
  const originalToken = process.env.N8N_ADMIN_WEBHOOK_TOKEN;
  const originalAdmins = process.env.ADMIN_EMAILS;
  const originalFetch = globalThis.fetch;
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.ADMIN_EMAILS = "admin@example.com";
  process.env.N8N_ADMIN_WEBHOOK_URL = "https://n8n.example/webhook/student-feedback-admin";
  process.env.N8N_ADMIN_WEBHOOK_TOKEN = "test-admin-token";
  const adminCookie = createSessionCookie({
    id: "firebase-admin-uid",
    name: "Admin",
    email: "admin@example.com",
  }).split(";")[0];
  const studentCookie = createSessionCookie({
    id: "firebase-student-uid",
    name: "Student",
    email: "student@example.com",
  }).split(";")[0];
  let upstreamRequest;
  globalThis.fetch = async (...args) => {
    upstreamRequest = args;
    return {
      ok: true,
      json: async () => ({
        feedback: [{
          studentId: "firebase-student-uid",
          studentName: "Student",
          email: "student@example.com",
          courseName: "UX",
          rating: "4",
          feedbackMessage: "Helpful",
          feedbackStatus: "Positive",
          submittedAt: "2026-01-02T00:00:00.000Z",
        }],
      }),
    };
  };

  try {
    const denied = await request("/api/admin/feedback", "GET", { cookie: studentCookie });
    assert.equal(denied.statusCode, 403);
    assert.equal(upstreamRequest, undefined);

    const response = await request("/api/admin/feedback", "GET", { cookie: adminCookie });
    assert.equal(response.statusCode, 200);
    assert.equal(upstreamRequest[0].toString(), process.env.N8N_ADMIN_WEBHOOK_URL);
    assert.equal(upstreamRequest[1].headers["X-Admin-Token"], "test-admin-token");
    assert.equal(response.body.feedback[0].studentId, "firebase-student-uid");
    assert.equal(response.body.feedback[0].rating, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalWebhook === undefined) delete process.env.N8N_ADMIN_WEBHOOK_URL;
    else process.env.N8N_ADMIN_WEBHOOK_URL = originalWebhook;
    if (originalToken === undefined) delete process.env.N8N_ADMIN_WEBHOOK_TOKEN;
    else process.env.N8N_ADMIN_WEBHOOK_TOKEN = originalToken;
    if (originalAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdmins;
  }
});
