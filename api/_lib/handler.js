import {
  clearSessionCookie,
  createSessionCookie,
  getSessionUser,
} from "../../server/auth-session.js";
import { verifyFirebaseCredential } from "../../server/firebase-auth.js";
import { fetchAdminFeedback } from "../../server/admin-feedback.js";
import { normalizeFeedback, sendFeedbackToWorkflow } from "../../server/feedback.js";

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

export async function handleApiRequest(req, res) {
  try {
    const url = new URL(req.url, "https://vercel.local");
    const route = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (route === "/api/health" && method === "GET") {
      return respond(res, 200, { status: "ok" });
    }
    if (route === "/api/auth/me" && method === "GET") {
      return respond(res, 200, { user: getSessionUser(req) });
    }
    if (route === "/api/auth/firebase" && method === "POST") {
      const identity = await verifyFirebaseCredential(getRequestBody(req).credential);
      return respond(res, 200, { user: identity }, {
        "Set-Cookie": createSessionCookie(identity),
      });
    }
    if (route === "/api/auth/signout" && method === "POST") {
      return respond(res, 200, { message: "Signed out." }, {
        "Set-Cookie": clearSessionCookie(),
      });
    }
    if (route === "/api/admin/feedback" && method === "GET") {
      const user = getSessionUser(req);
      if (!user) return respond(res, 401, { message: "Please sign in to continue." });
      if (user.role !== "admin") {
        return respond(res, 403, { message: "Admin access is required." });
      }
      return respond(res, 200, { feedback: await fetchAdminFeedback() });
    }
    if (route === "/api/feedback" && method === "POST") {
      const user = getSessionUser(req);
      if (!user) return respond(res, 401, { message: "Please sign in to continue." });
      const feedback = normalizeFeedback(user, getRequestBody(req));
      await sendFeedbackToWorkflow(feedback);
      return respond(res, 201, { message: "Thank you! Your feedback has been received." });
    }
    return respond(res, 404, { message: "API route not found." });
  } catch (error) {
    console.error("Feedback API request failed:", error.message);
    const status = Number.isInteger(error.status) ? error.status : 500;
    const message = status < 500 ? error.message : "The request could not be completed.";
    return respond(res, status, { message });
  }
}
