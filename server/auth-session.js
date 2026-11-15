import { createHmac, timingSafeEqual } from "node:crypto";
import { validateEmail } from "./security.js";

const SESSION_COOKIE = "feedback.sid";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
  }
  return secret;
}

function isSecureCookie() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

export function createSessionCookie(user) {
  const session = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: "student",
    expiresAt: Date.now() + SESSION_LIFETIME_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  const secure = isSecureCookie() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${payload}.${signature}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = isSecureCookie() ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export function getSessionUser(request) {
  const cookieHeader = request.headers.cookie ?? "";
  const cookieValue = cookieHeader.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!cookieValue || cookieValue.length > 2048) return null;

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
    if (typeof session.id !== "string" ||
        typeof session.name !== "string" ||
        typeof session.email !== "string" ||
        !validateEmail(session.email) ||
        session.role !== "student" ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()) {
      return null;
    }
    return {
      id: session.id,
      name: session.name,
      email: session.email,
      role: "student",
    };
  } catch {
    return null;
  }
}
