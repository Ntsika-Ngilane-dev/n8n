import { timingSafeEqual, createHmac } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { cleanText, hashPassword, validateEmail, verifyPassword } from "../../server/security.js";
import { getDatabase, initializeDatabase } from "./database.js";

const SESSION_COOKIE = "feedback.sid";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LIMIT = 15;
const googleClient = new OAuth2Client();

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
  }
  return secret;
}

function createSessionCookie(userId) {
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    expiresAt: Date.now() + SESSION_LIFETIME_SECONDS * 1000,
  })).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${SESSION_COOKIE}=${payload}.${signature}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${SESSION_LIFETIME_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`;
}

function parseSessionCookie(req) {
  const cookieHeader = req.headers.cookie ?? "";
  const cookieValue = cookieHeader.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!cookieValue) return null;

  const separator = cookieValue.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = cookieValue.slice(0, separator);
  const suppliedSignature = Buffer.from(cookieValue.slice(separator + 1), "base64url");
  const expectedSignature = createHmac("sha256", getSessionSecret()).update(payload).digest();
  if (suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.userId !== "string" ||
        !/^\d+$/.test(session.userId) ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function getRequestBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string") {
    try {
      const body = JSON.parse(req.body);
      return body && typeof body === "object" && !Array.isArray(body) ? body : {};
    } catch {
      return {};
    }
  }
  return {};
}

function respond(res, status, body, headers = {}) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getLecturerCourses(email) {
  let mappings;
  try {
    mappings = JSON.parse(process.env.LECTURER_COURSES ?? "{}");
  } catch (error) {
    throw new Error("LECTURER_COURSES must contain valid JSON.", { cause: error });
  }
  const key = Object.keys(mappings).find((candidate) => candidate.toLowerCase() === email.toLowerCase());
  return key && Array.isArray(mappings[key])
    ? mappings[key].filter((course) => typeof course === "string")
    : [];
}

function getRoleForEmail(email) {
  const normalizedEmail = email.toLowerCase();
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (normalizedEmail === process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() ||
      admins.includes(normalizedEmail)) {
    return "admin";
  }
  return getLecturerCourses(email).length > 0 ? "lecturer" : "student";
}

async function ensureInitialAdmin(database) {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email && !password) return;

  const name = cleanText(process.env.INITIAL_ADMIN_NAME ?? "Training Administrator", 100);
  if (!validateEmail(email) || typeof password !== "string" || password.length < 12) {
    throw new Error("Set a valid INITIAL_ADMIN_EMAIL and an INITIAL_ADMIN_PASSWORD of at least 12 characters.");
  }

  const existing = await database.query(
    "SELECT id FROM users WHERE LOWER(email) = $1",
    [email],
  );
  if (existing.rowCount) {
    await database.query("UPDATE users SET role = 'admin' WHERE id = $1", [existing.rows[0].id]);
    return;
  }

  const passwordHash = await hashPassword(password);
  await database.query(
    `INSERT INTO users (name, email, password_hash, role, created_at)
     VALUES ($1, $2, $3, 'admin', NOW())
     ON CONFLICT DO NOTHING`,
    [name, email, passwordHash],
  );
}

async function getCurrentUser(req, database) {
  const session = parseSessionCookie(req);
  if (!session) return null;
  const result = await database.query(
    "SELECT id, name, email, role FROM users WHERE id = $1",
    [session.userId],
  );
  return result.rows[0] ?? null;
}

async function limitAuthAttempts(req, database) {
  const forwarded = req.headers["x-forwarded-for"];
  const ipAddress = (typeof forwarded === "string" ? forwarded.split(",")[0] : "unknown").trim().slice(0, 100);
  const result = await database.query(
    `INSERT INTO auth_rate_limits (ip_address, hits, reset_at)
     VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 millisecond'))
     ON CONFLICT (ip_address) DO UPDATE SET
       hits = CASE WHEN auth_rate_limits.reset_at <= NOW() THEN 1 ELSE auth_rate_limits.hits + 1 END,
       reset_at = CASE WHEN auth_rate_limits.reset_at <= NOW()
         THEN NOW() + ($2 * INTERVAL '1 millisecond')
         ELSE auth_rate_limits.reset_at END
     RETURNING hits`,
    [ipAddress, AUTH_WINDOW_MS],
  );
  return Number(result.rows[0].hits) <= AUTH_LIMIT;
}

async function authenticateGoogleCredential(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error("Google sign-in is not configured on this server.");
    error.status = 503;
    throw error;
  }
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified || !payload.sub) {
    const error = new Error("Google did not provide a verified email address.");
    error.status = 401;
    throw error;
  }
  return {
    googleSub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: cleanText(payload.name ?? payload.email, 100),
  };
}

async function handleSignup(req, res, database) {
  const body = getRequestBody(req);
  const name = cleanText(body.name, 100);
  const email = cleanText(body.email, 254).toLowerCase();
  const password = body.password;
  if (name.length < 2 || !validateEmail(email)) {
    return respond(res, 400, { message: "Enter your name and a valid email address." });
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    return respond(res, 400, { message: "Use a password between 12 and 256 characters." });
  }

  const passwordHash = await hashPassword(password);
  try {
    const result = await database.query(
      `INSERT INTO users (name, email, password_hash, role, created_at)
       VALUES ($1, $2, $3, 'student', NOW())
       RETURNING id, name, email, role`,
      [name, email, passwordHash],
    );
    return respond(res, 201, { user: result.rows[0] }, {
      "Set-Cookie": createSessionCookie(result.rows[0].id),
    });
  } catch (error) {
    if (error.code === "23505") {
      return respond(res, 409, { message: "An account with this email already exists. Sign in instead." });
    }
    throw error;
  }
}

async function handleSignin(req, res, database) {
  const body = getRequestBody(req);
  const email = cleanText(body.email, 254).toLowerCase();
  if (!validateEmail(email) || typeof body.password !== "string") {
    return respond(res, 400, { message: "Enter your email and password." });
  }
  const result = await database.query(
    "SELECT * FROM users WHERE LOWER(email) = $1",
    [email],
  );
  const user = result.rows[0];
  if (!user?.password_hash || !(await verifyPassword(body.password, user.password_hash))) {
    return respond(res, 401, { message: "Email or password is incorrect." });
  }
  return respond(res, 200, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }, {
    "Set-Cookie": createSessionCookie(user.id),
  });
}

async function handleGoogleSignin(req, res, database) {
  const body = getRequestBody(req);
  if (typeof body.credential !== "string" || !body.credential) {
    return respond(res, 400, { message: "A Google credential is required." });
  }
  const identity = await authenticateGoogleCredential(body.credential);
  const existing = await database.query(
    "SELECT * FROM users WHERE google_sub = $1 OR LOWER(email) = $2",
    [identity.googleSub, identity.email],
  );
  let user = existing.rows[0];

  if (user) {
    if (user.google_sub && user.google_sub !== identity.googleSub) {
      return respond(res, 409, { message: "This email is linked to a different Google account." });
    }
    const trustedRole = getRoleForEmail(identity.email);
    const role = user.role === "student" && trustedRole !== "student" ? trustedRole : user.role;
    const updated = await database.query(
      `UPDATE users SET google_sub = $1, role = $2 WHERE id = $3
       RETURNING id, name, email, role`,
      [identity.googleSub, role, user.id],
    );
    user = updated.rows[0];
  } else {
    const created = await database.query(
      `INSERT INTO users (name, email, google_sub, role, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, name, email, role`,
      [identity.name, identity.email, identity.googleSub, getRoleForEmail(identity.email)],
    );
    user = created.rows[0];
  }

  return respond(res, 200, { user }, {
    "Set-Cookie": createSessionCookie(user.id),
  });
}

async function handleFeedback(req, res, database, user) {
  if (!user) return respond(res, 401, { message: "Please sign in to continue." });
  if (user.role !== "student") {
    return respond(res, 403, { message: "Only student accounts can submit course feedback." });
  }

  const body = getRequestBody(req);
  const courseName = cleanText(body.courseName, 150);
  const feedbackMessage = cleanText(body.feedbackMessage, 2000);
  const rating = Number(body.rating);
  if (!courseName || !feedbackMessage || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return respond(res, 400, { message: "Enter a course, feedback message, and rating from 1 to 5." });
  }

  const submittedAt = new Date().toISOString();
  const feedbackStatus = rating <= 2 ? "Needs follow-up" : "Positive";
  await database.query(
    `INSERT INTO feedback
      (student_id, student_name, student_email, course_name, rating, feedback_message, feedback_status, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [user.id, user.name, user.email, courseName, rating, feedbackMessage, feedbackStatus, submittedAt],
  );

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return respond(res, 202, {
      message: "Feedback was saved, but the email notification is not configured.",
      automationPending: true,
    });
  }
  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentName: user.name,
        email: user.email,
        courseName,
        rating,
        feedbackMessage,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!webhookResponse.ok) {
      console.error(`n8n feedback webhook returned HTTP ${webhookResponse.status}.`);
      return respond(res, 202, {
        message: "Feedback was saved, but the email notification could not be sent.",
        automationPending: true,
      });
    }
  } catch (error) {
    console.error("Could not contact the configured n8n feedback webhook.", error.message);
    return respond(res, 202, {
      message: "Feedback was saved, but the email notification could not be sent.",
      automationPending: true,
    });
  }
  return respond(res, 201, { message: "Thank you! Your feedback has been received." });
}

async function handleReviews(req, res, database, user, searchParams) {
  if (!user) return respond(res, 401, { message: "Please sign in to continue." });
  if (!["lecturer", "admin"].includes(user.role)) {
    return respond(res, 403, { message: "This page is for lecturers." });
  }

  const course = cleanText(searchParams.get("course") ?? "", 150);
  const lecturerCourses = user.role === "lecturer" ? getLecturerCourses(user.email) : null;
  if (lecturerCourses && lecturerCourses.length === 0) {
    return respond(res, 200, { reviews: [], courses: [], message: "No courses are assigned to this lecturer yet." });
  }
  if (course && lecturerCourses && !lecturerCourses.includes(course)) {
    return respond(res, 403, { message: "You are not assigned to this course." });
  }

  const filters = [];
  const values = [];
  if (lecturerCourses) {
    values.push(lecturerCourses);
    filters.push(`course_name = ANY($${values.length}::text[])`);
  }
  if (course) {
    values.push(course);
    filters.push(`course_name = $${values.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const reviews = await database.query(
    `SELECT id, student_name AS "studentName", course_name AS "courseName",
       rating, feedback_message AS "feedbackMessage", feedback_status AS "feedbackStatus",
       submitted_at AS "submittedAt"
     FROM feedback ${where} ORDER BY submitted_at DESC`,
    values,
  );
  let courses;
  if (lecturerCourses) {
    courses = lecturerCourses;
  } else {
    const result = await database.query(
      "SELECT DISTINCT course_name AS \"courseName\" FROM feedback ORDER BY course_name",
    );
    courses = result.rows.map((row) => row.courseName);
  }
  return respond(res, 200, { reviews: reviews.rows, courses });
}

async function handleAnalytics(res, database, user) {
  if (!user) return respond(res, 401, { message: "Please sign in to continue." });
  if (user.role !== "admin") {
    return respond(res, 403, { message: "Administrator access is required." });
  }
  const totals = await database.query(`
    SELECT COUNT(*)::int AS submissions, ROUND(AVG(rating), 2) AS "averageRating",
      COUNT(*) FILTER (WHERE rating <= 2)::int AS "needsFollowUp"
    FROM feedback
  `);
  const courses = await database.query(`
    SELECT course_name AS "courseName", COUNT(*)::int AS submissions,
      ROUND(AVG(rating), 2) AS "averageRating",
      COUNT(*) FILTER (WHERE rating <= 2)::int AS "needsFollowUp"
    FROM feedback GROUP BY course_name ORDER BY course_name
  `);
  return respond(res, 200, { ...totals.rows[0], byCourse: courses.rows });
}

export async function handleApiRequest(req, res) {
  try {
    await initializeDatabase();
    const database = getDatabase();
    await ensureInitialAdmin(database);

    const url = new URL(req.url, "https://vercel.local");
    const route = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";
    const body = getRequestBody(req);

    const isAuthenticationAttempt =
      method === "POST" &&
      ["/api/auth/signup", "/api/auth/signin", "/api/auth/google"].includes(route);
    if (isAuthenticationAttempt && !(await limitAuthAttempts(req, database))) {
      return respond(res, 429, { message: "Too many attempts. Wait a little and try again." });
    }
    if (route === "/api/health" && method === "GET") {
      return respond(res, 200, { status: "ok" });
    }
    if (route === "/api/auth/me" && method === "GET") {
      return respond(res, 200, { user: await getCurrentUser(req, database) });
    }
    if (route === "/api/auth/signup" && method === "POST") {
      return await handleSignup(req, res, database);
    }
    if (route === "/api/auth/signin" && method === "POST") {
      return await handleSignin(req, res, database);
    }
    if (route === "/api/auth/google" && method === "POST") {
      return await handleGoogleSignin(req, res, database);
    }
    if (route === "/api/auth/signout" && method === "POST") {
      const user = await getCurrentUser(req, database);
      if (!user) return respond(res, 401, { message: "Please sign in to continue." });
      return respond(res, 200, { message: "Signed out." }, { "Set-Cookie": clearSessionCookie() });
    }

    const user = await getCurrentUser(req, database);
    if (route === "/api/feedback" && method === "POST") {
      return await handleFeedback(req, res, database, user);
    }
    if (route === "/api/reviews" && method === "GET") {
      return await handleReviews(req, res, database, user, url.searchParams);
    }
    if (route === "/api/admin/analytics" && method === "GET") {
      return await handleAnalytics(res, database, user);
    }
    return respond(res, 404, { message: "API route not found." });
  } catch (error) {
    console.error("Feedback API request failed:", error.message);
    const status = Number.isInteger(error.status) ? error.status : 500;
    const message = status < 500 ? error.message : "The request could not be completed.";
    return respond(res, status, { message });
  }
}
