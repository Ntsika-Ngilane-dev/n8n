import { cleanText } from "./security.js";

export function normalizeFeedback(user, body) {
  const courseName = cleanText(body?.courseName, 150);
  const feedbackMessage = cleanText(body?.feedbackMessage, 2000);
  const rating = Number(body?.rating);
  if (!courseName || !feedbackMessage || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    const error = new Error("Enter a course, feedback message, and rating from 1 to 5.");
    error.status = 400;
    throw error;
  }

  return {
    studentName: user.name,
    email: user.email,
    courseName,
    rating,
    feedbackMessage,
  };
}

export async function sendFeedbackToWorkflow(feedback) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    const error = new Error("The feedback workflow is not configured.");
    error.status = 503;
    throw error;
  }

  let response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback),
      signal: AbortSignal.timeout(10000),
    });
  } catch (cause) {
    const error = new Error("Could not reach the feedback workflow. Please try again.", { cause });
    error.status = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error("The feedback workflow could not confirm your submission. Please try again.");
    error.status = 502;
    throw error;
  }
}
