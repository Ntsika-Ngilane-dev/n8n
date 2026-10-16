import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "./session-store.js";
import { hashPassword, validateEmail, validatePhone, verifyPassword } from "./security.js";

test("password hashes are salted and only verify the matching password", async () => {
  const password = "correct horse battery staple";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.notEqual(hash, await hashPassword(password));
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
});

test("email and WhatsApp phone validation require expected formats", () => {
  assert.equal(validateEmail("student@example.com"), true);
  assert.equal(validateEmail("not-an-email"), false);
  assert.equal(validatePhone("+14155552671"), true);
  assert.equal(validatePhone("4155552671"), false);
});

test("SQLite session store persists, expires, and deletes a session", async () => {
  const database = new Database(":memory:");
  const store = new SqliteSessionStore(database);
  const session = { userId: 7, cookie: { maxAge: 60_000 } };

  await new Promise((resolve, reject) => {
    store.set("session-id", session, (error) => error ? reject(error) : resolve());
  });
  const restored = await new Promise((resolve, reject) => {
    store.get("session-id", (error, value) => error ? reject(error) : resolve(value));
  });
  assert.equal(restored.userId, 7);

  await new Promise((resolve, reject) => {
    store.destroy("session-id", (error) => error ? reject(error) : resolve());
  });
  const deleted = await new Promise((resolve, reject) => {
    store.get("session-id", (error, value) => error ? reject(error) : resolve(value));
  });
  assert.equal(deleted, null);
  database.close();
});
