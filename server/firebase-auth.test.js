import assert from "node:assert/strict";
import test from "node:test";
import { verifyFirebaseCredential } from "./firebase-auth.js";

test("Firebase rejects missing server configuration and empty credentials", async () => {
  const originalApiKey = process.env.FIREBASE_API_KEY;
  delete process.env.FIREBASE_API_KEY;
  try {
    await assert.rejects(verifyFirebaseCredential("token"), { status: 503 });
    process.env.FIREBASE_API_KEY = "test-api-key";
    await assert.rejects(verifyFirebaseCredential(""), { status: 400 });
  } finally {
    if (originalApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalApiKey;
  }
});

test("Firebase ID tokens resolve only to verified student identities", async () => {
  const originalApiKey = process.env.FIREBASE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.FIREBASE_API_KEY = "test-api-key";
  let requestUrl;
  let requestBody;
  globalThis.fetch = async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        users: [{
          localId: "firebase-uid-123",
          displayName: "  Avery Student ",
          email: "AVERY@example.com",
          emailVerified: true,
        }],
      }),
    };
  };

  try {
    const user = await verifyFirebaseCredential("firebase-id-token");
    assert.match(requestUrl, /accounts:lookup\?key=test-api-key$/);
    assert.deepEqual(requestBody, { idToken: "firebase-id-token" });
    assert.deepEqual(user, {
      id: "firebase-uid-123",
      name: "Avery Student",
      email: "avery@example.com",
      role: "student",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalApiKey;
  }
});

test("Firebase rejects unverified email and invalid ID tokens", async () => {
  const originalApiKey = process.env.FIREBASE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.FIREBASE_API_KEY = "test-api-key";

  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        users: [{
          localId: "firebase-uid-123",
          email: "avery@example.com",
          emailVerified: false,
        }],
      }),
    });
    await assert.rejects(verifyFirebaseCredential("unverified-token"), { status: 403 });

    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ error: { message: "INVALID_ID_TOKEN" } }),
    });
    await assert.rejects(verifyFirebaseCredential("invalid-token"), { status: 401 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalApiKey;
  }
});
