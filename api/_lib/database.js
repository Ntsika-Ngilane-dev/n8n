import pg from "pg";

const { Pool } = pg;

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'lecturer', 'admin')),
    created_at TIMESTAMPTZ NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

  CREATE TABLE IF NOT EXISTS feedback (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES users(id),
    student_name TEXT NOT NULL,
    student_email TEXT NOT NULL,
    course_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_message TEXT NOT NULL,
    feedback_status TEXT NOT NULL CHECK (feedback_status IN ('Needs follow-up', 'Positive')),
    submitted_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS feedback_course_idx ON feedback(course_name);
  CREATE INDEX IF NOT EXISTS feedback_date_idx ON feedback(submitted_at);

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    ip_address TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
  );
`;

let database;
let schemaSetup;

export function getDatabase() {
  if (!database) {
    const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Set POSTGRES_URL (or DATABASE_URL) to a persistent PostgreSQL connection string.");
    }
    database = new Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });
  }
  return database;
}

export async function initializeDatabase() {
  if (!schemaSetup) {
    schemaSetup = getDatabase().query(schema).catch((error) => {
      schemaSetup = undefined;
      throw error;
    });
  }
  await schemaSetup;
}
