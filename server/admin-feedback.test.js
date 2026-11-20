import assert from "node:assert/strict";
import test from "node:test";
import { fetchAdminFeedback, normalizeAdminFeedbackRows } from "./admin-feedback.js";

const row = {
  studentId: "firebase-student-uid",
  studentName: "Avery Student",
  email: "AVERY@example.com",
  courseName: "Introduction to UX",
  rating: "4",
  feedbackMessage: "  Helpful course.  ",
  feedbackStatus: "Positive",
  submittedAt: "2026-01-02T00:00:00.000Z",
};

test("admin sheet rows are normalized and retain the Firebase account ID", () => {
  assert.deepEqual(normalizeAdminFeedbackRows([row]), [{
    studentId: "firebase-student-uid",
    studentName: "Avery Student",
    email: "avery@example.com",
    courseName: "Introduction to UX",
    rating: 4,
    feedbackMessage: "Helpful course.",
    feedbackStatus: "Positive",
    submittedAt: "2026-01-02T00:00:00.000Z",
  }]);
});

test("admin sheet rows reject invalid ratings or identity fields", () => {
  assert.throws(
    () => normalizeAdminFeedbackRows([{ ...row, rating: 8 }]),
    { status: 502 },
  );
  assert.throws(() => normalizeAdminFeedbackRows({ feedback: [] }), { status: 502 });
});

test("admin feedback is loaded through the configured protected webhook", async () => {
  const originalUrl = process.env.N8N_ADMIN_WEBHOOK_URL;
  const originalToken = process.env.N8N_ADMIN_WEBHOOK_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.N8N_ADMIN_WEBHOOK_URL = "https://n8n.example/webhook/student-feedback-admin";
  process.env.N8N_ADMIN_WEBHOOK_TOKEN = "test-token";
  let request;
  globalThis.fetch = async (...args) => {
    request = args;
    return { ok: true, json: async () => ({ feedback: [row] }) };
  };

  try {
    const feedback = await fetchAdminFeedback();
    assert.equal(feedback.length, 1);
    assert.equal(request[1].headers["X-Admin-Token"], "test-token");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.N8N_ADMIN_WEBHOOK_URL;
    else process.env.N8N_ADMIN_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.N8N_ADMIN_WEBHOOK_TOKEN;
    else process.env.N8N_ADMIN_WEBHOOK_TOKEN = originalToken;
  }
});

test("admin feedback configuration fails explicitly when the protected webhook is missing", async () => {
  const originalUrl = process.env.N8N_ADMIN_WEBHOOK_URL;
  const originalToken = process.env.N8N_ADMIN_WEBHOOK_TOKEN;
  delete process.env.N8N_ADMIN_WEBHOOK_URL;
  delete process.env.N8N_ADMIN_WEBHOOK_TOKEN;
  try {
    await assert.rejects(fetchAdminFeedback(), { status: 503 });
  } finally {
    if (originalUrl === undefined) delete process.env.N8N_ADMIN_WEBHOOK_URL;
    else process.env.N8N_ADMIN_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.N8N_ADMIN_WEBHOOK_TOKEN;
    else process.env.N8N_ADMIN_WEBHOOK_TOKEN = originalToken;
  }
});

test("admin webhook failures explain which production setting to check", async () => {
  const originalUrl = process.env.N8N_ADMIN_WEBHOOK_URL;
  const originalToken = process.env.N8N_ADMIN_WEBHOOK_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.N8N_ADMIN_WEBHOOK_URL = "https://n8n.example/webhook/student-feedback-admin";
  process.env.N8N_ADMIN_WEBHOOK_TOKEN = "test-token";
  globalThis.fetch = async () => ({ ok: false, status: 403 });

  try {
    await assert.rejects(fetchAdminFeedback(), {
      status: 502,
      publicMessage: /N8N_ADMIN_WEBHOOK_TOKEN/,
    });

    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(fetchAdminFeedback(), {
      status: 502,
      publicMessage: /N8N_ADMIN_WEBHOOK_URL/,
    });

    globalThis.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(fetchAdminFeedback(), {
      status: 502,
      publicMessage: /n8n execution and Google Sheets/,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.N8N_ADMIN_WEBHOOK_URL;
    else process.env.N8N_ADMIN_WEBHOOK_URL = originalUrl;
    if (originalToken === undefined) delete process.env.N8N_ADMIN_WEBHOOK_TOKEN;
    else process.env.N8N_ADMIN_WEBHOOK_TOKEN = originalToken;
  }
});
