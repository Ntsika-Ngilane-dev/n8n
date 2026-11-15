import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import {
  clearSessionCookie,
  createSessionCookie,
  getSessionUser,
} from "./auth-session.js";
import { verifyFirebaseCredential } from "./firebase-auth.js";
import { fetchAdminFeedback } from "./admin-feedback.js";
import { normalizeFeedback, sendFeedbackToWorkflow } from "./feedback.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many attempts. Wait a little and try again." },
});
app.use("/api/auth/firebase", authLimiter);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/auth/me", (req, res, next) => {
  try {
    res.json({ user: getSessionUser(req) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/firebase", async (req, res, next) => {
  try {
    const user = await verifyFirebaseCredential(req.body?.credential);
    res.setHeader("Set-Cookie", createSessionCookie(user));
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/signout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ message: "Signed out." });
});

app.get("/api/admin/feedback", async (req, res, next) => {
  try {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ message: "Please sign in to continue." });
    if (user.role !== "admin") {
      return res.status(403).json({ message: "Admin access is required." });
    }
    res.json({ feedback: await fetchAdminFeedback() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/feedback", async (req, res, next) => {
  try {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ message: "Please sign in to continue." });
    const feedback = normalizeFeedback(user, req.body);
    await sendFeedbackToWorkflow(feedback);
    res.status(201).json({ message: "Thank you! Your feedback has been received." });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error("Feedback API request failed:", error.message);
  const status = Number.isInteger(error.status) ? error.status : 500;
  const message = status < 500 ? error.message : "The request could not be completed.";
  res.status(status).json({ message });
});

app.listen(port, () => {
  console.log(`Feedback API listening on http://localhost:${port}`);
});
