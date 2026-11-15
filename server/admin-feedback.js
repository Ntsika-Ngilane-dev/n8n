import { cleanText, validateEmail } from "./security.js";

function createAdminFeedbackError(message, status, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  return error;
}

export function normalizeAdminFeedbackRows(rows) {
  if (!Array.isArray(rows)) {
    throw createAdminFeedbackError("The feedback workflow returned invalid data.", 502);
  }

  return rows.map((row) => {
    const rating = Number(row?.rating);
    const record = {
      studentId: cleanText(row?.studentId, 128),
      studentName: cleanText(row?.studentName, 100),
      email: cleanText(row?.email, 254).toLowerCase(),
      courseName: cleanText(row?.courseName, 150),
      rating,
      feedbackMessage: cleanText(row?.feedbackMessage, 2000),
      feedbackStatus: cleanText(row?.feedbackStatus, 50),
      submittedAt: cleanText(row?.submittedAt, 80),
    };

    if (!record.studentName ||
        !validateEmail(record.email) ||
        !record.courseName ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5 ||
        !record.feedbackMessage) {
      throw createAdminFeedbackError("The feedback workflow returned an invalid feedback row.", 502);
    }

    return record;
  });
}

export async function fetchAdminFeedback() {
  const webhookUrl = process.env.N8N_ADMIN_WEBHOOK_URL;
  const token = process.env.N8N_ADMIN_WEBHOOK_TOKEN;
  if (!webhookUrl || !token) {
    throw createAdminFeedbackError("The admin feedback workflow is not configured.", 503);
  }

  let url;
  try {
    url = new URL(webhookUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("The admin feedback webhook must use HTTPS.");
    }
  } catch (cause) {
    throw createAdminFeedbackError("The admin feedback workflow is not configured correctly.", 503, cause);
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { "X-Admin-Token": token },
      signal: AbortSignal.timeout(10000),
    });
  } catch (cause) {
    throw createAdminFeedbackError("Could not reach the admin feedback workflow.", 502, cause);
  }

  if (!response.ok) {
    throw createAdminFeedbackError("The admin feedback workflow could not load feedback.", 502);
  }

  let result;
  try {
    result = await response.json();
  } catch (cause) {
    throw createAdminFeedbackError("The admin feedback workflow returned an invalid response.", 502, cause);
  }

  return normalizeAdminFeedbackRows(result?.feedback);
}
