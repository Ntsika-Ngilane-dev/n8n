import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

export const dataDirectory = path.resolve(process.env.DATA_DIRECTORY ?? "data");
mkdirSync(dataDirectory, { recursive: true });

export const database = new Database(path.join(dataDirectory, "feedback.sqlite"));
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");

database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'lecturer', 'admin')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_auth (
    id TEXT PRIMARY KEY,
    flow TEXT NOT NULL CHECK (flow IN ('password', 'google')),
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    phone TEXT NOT NULL,
    password_hash TEXT,
    google_sub TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES users(id),
    student_name TEXT NOT NULL,
    student_email TEXT NOT NULL,
    course_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_message TEXT NOT NULL,
    feedback_status TEXT NOT NULL CHECK (feedback_status IN ('Needs follow-up', 'Positive')),
    submitted_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS feedback_course_idx ON feedback(course_name);
  CREATE INDEX IF NOT EXISTS feedback_date_idx ON feedback(submitted_at);
`);

export function listLecturerCourses(email) {
  let mappings = {};
  try {
    mappings = JSON.parse(process.env.LECTURER_COURSES ?? "{}");
  } catch (error) {
    throw new Error("LECTURER_COURSES must contain valid JSON.", { cause: error });
  }
  const key = Object.keys(mappings).find(
    (candidate) => candidate.toLowerCase() === email.toLowerCase(),
  );
  return key && Array.isArray(mappings[key])
    ? mappings[key].filter((course) => typeof course === "string")
    : [];
}

export function roleForEmail(email) {
  const configuredAdmins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (email.toLowerCase() === process.env.INITIAL_ADMIN_EMAIL?.toLowerCase()) {
    return "admin";
  }
  if (configuredAdmins.includes(email.toLowerCase())) return "admin";
  if (listLecturerCourses(email).length > 0) return "lecturer";
  return "student";
}
