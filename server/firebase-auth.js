import { cleanText, validateEmail } from "./security.js";
import { getUserRole } from "./auth-session.js";

const invalidCredentialCodes = new Set([
  "INVALID_ID_TOKEN",
  "TOKEN_EXPIRED",
  "USER_NOT_FOUND",
  "USER_DISABLED",
]);
const configurationErrorCodes = new Set([
  "API_KEY_INVALID",
  "PROJECT_NOT_FOUND",
  "CONFIGURATION_NOT_FOUND",
]);

function createAuthError(message, status, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  return error;
}

export async function verifyFirebaseCredential(credential) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    throw createAuthError("Firebase Authentication is not configured on this server.", 503);
  }
  if (typeof credential !== "string" || !credential || credential.length > 8192) {
    throw createAuthError("A valid Firebase sign-in credential is required.", 400);
  }

  let response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: credential }),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch (cause) {
    throw createAuthError("Firebase could not verify this sign-in. Please try again.", 502, cause);
  }

  let result;
  try {
    result = await response.json();
  } catch (cause) {
    throw createAuthError("Firebase returned an invalid sign-in response.", 502, cause);
  }

  if (!response.ok) {
    const code = result?.error?.message;
    const status = configurationErrorCodes.has(code)
      ? 503
      : invalidCredentialCodes.has(code) ? 401 : 502;
    throw createAuthError(
      status === 401
        ? "Firebase could not verify this sign-in. Please try again."
        : "Firebase sign-in verification is unavailable. Check the Firebase configuration.",
      status,
    );
  }

  const user = result?.users?.[0];
  if (!user?.localId || !user.email || !validateEmail(user.email)) {
    throw createAuthError("Firebase did not return a valid account.", 401);
  }
  if (user.emailVerified !== true) {
    throw createAuthError("Verify your email address before signing in.", 403);
  }

  return {
    id: user.localId,
    email: user.email.trim().toLowerCase(),
    name: cleanText(user.displayName || user.email, 100) || user.email,
    role: getUserRole(user.email),
  };
}
