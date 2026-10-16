import "dotenv/config";
import express from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import { OAuth2Client } from "google-auth-library";
import twilio from "twilio";
import { randomUUID } from "node:crypto";
import { database, listLecturerCourses, roleForEmail } from "./db.js";
import { SqliteSessionStore } from "./session-store.js";
import { cleanText, hashPassword, validateEmail, validatePhone, verifyPassword } from "./security.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
}
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const sessionStore = new SqliteSessionStore(database);
const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(express.json({ limit: "16kb" }));
app.use(
  session({
    name: "feedback.sid",
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many attempts. Wait a little and try again." },
});
app.use("/api/auth", authLimiter);

const getUser = database.prepare(
  "SELECT id, name, email, phone, role FROM users WHERE id = ?",
);
const getByEmail = database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE");

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function requireAuth(req, res, next) {
  const user = req.session.userId ? getUser.get(req.session.userId) : null;
  if (!user) return res.status(401).json({ message: "Please sign in to continue." });
  req.user = user;
  next();
}

function requireStaff(req, res, next) {
  if (!["lecturer", "admin"].includes(req.user.role)) {
    return res.status(403).json({ message: "This page is for lecturers." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Administrator access is required." });
  }
  next();
}

function setSession(req, user, res) {
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ message: "Could not start a secure session." });
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  });
}

function serviceClients() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    const error = new Error("WhatsApp verification is not configured on this server.");
    error.status = 503;
    throw error;
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    .verify.v2.services(TWILIO_VERIFY_SERVICE_SID);
}

async function sendWhatsAppCode(phone) {
  await serviceClients().verifications.create({
    to: phone,
    channel: "whatsapp",
  });
}

async function checkWhatsAppCode(phone, code) {
  const result = await serviceClients().verificationChecks.create({
    to: phone,
    code,
  });
  return result.status === "approved";
}

async function verifyGoogleCredential(credential) {
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
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: cleanText(payload.name ?? payload.email, 100),
  };
}

function startPendingAuth({ flow, name, email, phone, passwordHash, googleSub }) {
  const challengeId = randomUUID();
  const now = Date.now();
  database.prepare(`
    INSERT INTO pending_auth
      (id, flow, name, email, phone, password_hash, google_sub, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    challengeId,
    flow,
    name,
    email,
    phone,
    passwordHash ?? null,
    googleSub ?? null,
    now + 10 * 60 * 1000,
    now,
  );
  return challengeId;
}

const createUser = database.prepare(`
  INSERT INTO users (name, email, phone, phone_verified, password_hash, google_sub, role, created_at)
  VALUES (?, ?, ?, 1, ?, ?, ?, ?)
`);
const cleanupExpiredChallenges = database.prepare(
  "DELETE FROM pending_auth WHERE expires_at <= ?",
);

app.get("/api/auth/me", (req, res) => {
  const user = req.session.userId ? getUser.get(req.session.userId) : null;
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/signup/start", async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name, 100);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const phone = cleanText(req.body?.phone, 16);
    const password = req.body?.password;
    if (name.length < 2 || !validateEmail(email) || !validatePhone(phone)) {
      return res.status(400).json({
        message: "Enter your name, a valid email, and a phone number in international format (for example +14155552671).",
      });
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      return res.status(400).json({ message: "Use a password between 12 and 256 characters." });
    }
    if (getByEmail.get(email)) {
      return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
    }
    const passwordHash = await hashPassword(password);
    await sendWhatsAppCode(phone);
    cleanupExpiredChallenges.run(Date.now());
    const challengeId = startPendingAuth({
      flow: "password",
      name,
      email,
      phone,
      passwordHash,
    });
    res.status(202).json({ challengeId, message: "A verification code has been sent by WhatsApp." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/google", async (req, res, next) => {
  try {
    const identity = await verifyGoogleCredential(req.body?.credential);
    const user = database.prepare(
      "SELECT * FROM users WHERE google_sub = ? OR email = ? COLLATE NOCASE",
    ).get(identity.sub, identity.email);
    if (user) {
      if (user.google_sub && user.google_sub !== identity.sub) {
        return res.status(409).json({ message: "This email is linked to a different Google account." });
      }
      if (!user.phone_verified) {
        return res.status(403).json({ message: "Verify your phone number before signing in." });
      }
      database.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(identity.sub, user.id);
      return setSession(req, getUser.get(user.id), res);
    }
    res.json({
      needsPhone: true,
      credential: req.body.credential,
      name: identity.name,
      email: identity.email,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/google/start", async (req, res, next) => {
  try {
    const identity = await verifyGoogleCredential(req.body?.credential);
    const phone = cleanText(req.body?.phone, 16);
    if (!validatePhone(phone)) {
      return res.status(400).json({ message: "Enter a phone number in international format (for example +14155552671)." });
    }
    const existing = database.prepare(
      "SELECT * FROM users WHERE google_sub = ? OR email = ? COLLATE NOCASE",
    ).get(identity.sub, identity.email);
    if (existing) {
      if (!existing.phone_verified) {
        return res.status(403).json({ message: "Verify your phone number before signing in." });
      }
      if (existing.google_sub && existing.google_sub !== identity.sub) {
        return res.status(409).json({ message: "This email is linked to a different Google account." });
      }
      database.prepare(
        "UPDATE users SET google_sub = ?, phone = COALESCE(phone, ?) WHERE id = ?",
      ).run(identity.sub, phone, existing.id);
      return setSession(req, getUser.get(existing.id), res);
    }
    await sendWhatsAppCode(phone);
    cleanupExpiredChallenges.run(Date.now());
    const challengeId = startPendingAuth({
      flow: "google",
      name: identity.name,
      email: identity.email,
      phone,
      googleSub: identity.sub,
    });
    res.status(202).json({ challengeId, message: "A verification code has been sent by WhatsApp." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/whatsapp/verify", async (req, res, next) => {
  try {
    const challengeId = cleanText(req.body?.challengeId, 50);
    const code = cleanText(req.body?.code, 10);
    if (!challengeId || !/^\d{4,10}$/.test(code)) {
      return res.status(400).json({ message: "Enter the WhatsApp verification code." });
    }
    const pending = database.prepare("SELECT * FROM pending_auth WHERE id = ?").get(challengeId);
    if (!pending || pending.expires_at <= Date.now()) {
      if (pending) database.prepare("DELETE FROM pending_auth WHERE id = ?").run(challengeId);
      return res.status(400).json({ message: "This verification code has expired. Start again to receive a new code." });
    }
    if (!(await checkWhatsAppCode(pending.phone, code))) {
      return res.status(400).json({ message: "That verification code is incorrect or expired." });
    }

    const existing = getByEmail.get(pending.email);
    if (existing) {
      if (pending.flow !== "google" || existing.google_sub !== pending.google_sub) {
        return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
      }
      database.prepare("DELETE FROM pending_auth WHERE id = ?").run(challengeId);
      return setSession(req, getUser.get(existing.id), res);
    }

    const insertUser = database.transaction(() => {
      const result = createUser.run(
        pending.name,
        pending.email,
        pending.phone,
        pending.password_hash,
        pending.google_sub,
        roleForEmail(pending.email),
        new Date().toISOString(),
      );
      database.prepare("DELETE FROM pending_auth WHERE id = ?").run(challengeId);
      return getUser.get(result.lastInsertRowid);
    });
    setSession(req, insertUser(), res);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/signin", async (req, res, next) => {
  try {
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = req.body?.password;
    if (!validateEmail(email) || typeof password !== "string") {
      return res.status(400).json({ message: "Enter your email and password." });
    }
    const user = getByEmail.get(email);
    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ message: "Email or password is incorrect." });
    }
    if (!user.phone_verified) {
      return res.status(403).json({ message: "Verify your phone number before signing in." });
    }
    setSession(req, getUser.get(user.id), res);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/signout", requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("feedback.sid", { httpOnly: true, sameSite: "lax" });
    res.json({ message: "Signed out." });
  });
});

app.post("/api/feedback", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only student accounts can submit course feedback." });
    }
    const courseName = cleanText(req.body?.courseName, 150);
    const feedbackMessage = cleanText(req.body?.feedbackMessage, 2000);
    const rating = Number(req.body?.rating);
    if (!courseName || !feedbackMessage || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Enter a course, feedback message, and rating from 1 to 5." });
    }
    const submittedAt = new Date().toISOString();
    const feedbackStatus = rating <= 2 ? "Needs follow-up" : "Positive";
    database.prepare(`
      INSERT INTO feedback
        (student_id, student_name, student_email, course_name, rating, feedback_message, feedback_status, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.user.name,
      req.user.email,
      courseName,
      rating,
      feedbackMessage,
      feedbackStatus,
      submittedAt,
    );

    if (!n8nWebhookUrl) {
      return res.status(202).json({
        message: "Feedback was saved, but the email notification is not configured.",
        automationPending: true,
      });
    }
    try {
      const automationResponse = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: req.user.name,
          email: req.user.email,
          courseName,
          rating,
          feedbackMessage,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!automationResponse.ok) {
        console.error(`n8n feedback webhook returned HTTP ${automationResponse.status}.`);
        return res.status(202).json({
          message: "Feedback was saved, but the email notification could not be sent.",
          automationPending: true,
        });
      }
    } catch (error) {
      console.error("Could not contact the configured n8n feedback webhook.", error.message);
      return res.status(202).json({
        message: "Feedback was saved, but the email notification could not be sent.",
        automationPending: true,
      });
    }
    res.status(201).json({ message: "Thank you! Your feedback has been received." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/reviews", requireAuth, requireStaff, (req, res) => {
  const course = cleanText(req.query.course, 150);
  const lecturerCourses = req.user.role === "lecturer" ? listLecturerCourses(req.user.email) : null;
  if (lecturerCourses && lecturerCourses.length === 0) {
    return res.json({ reviews: [], courses: [], message: "No courses are assigned to this lecturer yet." });
  }
  const where = [];
  const values = [];
  if (lecturerCourses) {
    where.push(`course_name IN (${lecturerCourses.map(() => "?").join(", ")})`);
    values.push(...lecturerCourses);
  }
  if (course) {
    if (lecturerCourses && !lecturerCourses.includes(course)) {
      return res.status(403).json({ message: "You are not assigned to this course." });
    }
    where.push("course_name = ?");
    values.push(course);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const reviews = database.prepare(`
    SELECT id, student_name AS studentName, course_name AS courseName,
      rating, feedback_message AS feedbackMessage, feedback_status AS feedbackStatus,
      submitted_at AS submittedAt
    FROM feedback ${whereSql}
    ORDER BY submitted_at DESC
  `).all(...values);
  const courses = lecturerCourses ?? database.prepare(
    "SELECT DISTINCT course_name AS courseName FROM feedback ORDER BY course_name",
  ).all().map((row) => row.courseName);
  res.json({ reviews, courses });
});

app.get("/api/admin/analytics", requireAuth, requireAdmin, (req, res) => {
  const totals = database.prepare(`
    SELECT COUNT(*) AS submissions, ROUND(AVG(rating), 2) AS averageRating,
      SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS needsFollowUp
    FROM feedback
  `).get();
  const byCourse = database.prepare(`
    SELECT course_name AS courseName, COUNT(*) AS submissions,
      ROUND(AVG(rating), 2) AS averageRating,
      SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS needsFollowUp
    FROM feedback GROUP BY course_name ORDER BY course_name
  `).all();
  res.json({ ...totals, byCourse });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use((error, _req, res, _next) => {
  console.error("Feedback API request failed:", error.message);
  const status = Number.isInteger(error.status) ? error.status : 500;
  const message = status < 500 ? error.message : "The request could not be completed.";
  res.status(status).json({ message });
});

async function bootstrapAdmin() {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const name = cleanText(process.env.INITIAL_ADMIN_NAME ?? "Training Administrator", 100);
  if (!email && !password) return;
  if (!validateEmail(email) || typeof password !== "string" || password.length < 12) {
    throw new Error("Set a valid INITIAL_ADMIN_EMAIL and an INITIAL_ADMIN_PASSWORD of at least 12 characters.");
  }
  const existing = getByEmail.get(email);
  if (existing) {
    database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    return;
  }
  const passwordHash = await hashPassword(password);
  createUser.run(name, email, null, passwordHash, null, "admin", new Date().toISOString());
}

await bootstrapAdmin();
app.listen(port, () => {
  console.log(`Feedback API listening on http://localhost:${port}`);
});
