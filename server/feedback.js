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
    studentId: user.id,
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
    error.publicMessage = "Feedback submission is unavailable. Configure N8N_WEBHOOK_URL with the active n8n production webhook.";
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
    error.publicMessage = "Could not reach the feedback workflow. Check N8N_WEBHOOK_URL and try again.";
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`The feedback workflow returned HTTP ${response.status}.`);
    error.status = 502;
    error.publicMessage = response.status === 404
      ? "The feedback endpoint returned 404. Set N8N_WEBHOOK_URL to the active Production URL from the correct n8n workflow, then redeploy."
      : `The feedback workflow returned HTTP ${response.status}. Check the n8n execution logs and Google Sheets configuration.`;
    throw error;
  }
}
