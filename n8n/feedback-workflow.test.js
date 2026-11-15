import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(
  readFileSync(new URL("./feedback-workflow.json", import.meta.url), "utf8"),
);
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const validate = new Function("$input", nodes.get("Validate Feedback").parameters.jsCode);

function validateSubmission(body) {
  return validate({ all: () => [{ json: { body } }] })[0].json;
}

const validSubmission = {
  studentId: "firebase-student-uid",
  studentName: "Avery Student",
  email: "avery@example.com",
  courseName: "Introduction to UX Design",
  rating: 5,
  feedbackMessage: "The hands-on exercises were helpful.",
};

test("workflow accepts and normalizes a valid feedback submission", () => {
  const result = validateSubmission({
    ...validSubmission,
    studentName: "  Avery Student  ",
    rating: "5",
  });

  assert.equal(result.isValid, true);
  assert.equal(result.studentId, "firebase-student-uid");
  assert.equal(result.studentName, "Avery Student");
  assert.equal(result.rating, 5);
  assert.deepEqual(result.errors, []);
  assert.ok(Number.isFinite(Date.parse(result.submittedAt)));
});

test("workflow rejects missing, malformed, non-text, and oversized fields", () => {
  const missing = validateSubmission({});
  assert.equal(missing.isValid, false);
  assert.ok(missing.errors.some((error) => error.includes("studentId")));
  assert.ok(missing.errors.some((error) => error.includes("studentName")));
  assert.ok(missing.errors.some((error) => error.includes("rating")));

  const invalid = validateSubmission({
    ...validSubmission,
    email: "not-an-email",
    courseName: {},
    feedbackMessage: "x".repeat(2001),
    rating: 6,
  });
  assert.equal(invalid.isValid, false);
  assert.ok(invalid.errors.includes("email must be valid"));
  assert.ok(invalid.errors.includes("courseName must be text"));
  assert.ok(invalid.errors.includes("feedbackMessage must be 2000 characters or fewer"));
  assert.ok(invalid.errors.includes("rating must be an integer from 1 to 5"));
});

test("workflow routes ratings at or below two to follow-up and higher ratings positive", () => {
  const ratingNode = nodes.get("Rating 2 or Below?");
  const condition = ratingNode.parameters.conditions.conditions[0];
  assert.equal(condition.operator.operation, "lte");
  assert.equal(condition.rightValue, 2);
  assert.equal(
    workflow.connections["Rating 2 or Below?"].main[0][0].node,
    "Mark Needs Follow-up",
  );
  assert.equal(
    workflow.connections["Rating 2 or Below?"].main[1][0].node,
    "Mark Positive",
  );
});

test("workflow maps every feedback field to the existing Sheet1 tab", () => {
  const sheetsParameters = nodes.get("Append to Google Sheets").parameters;

  assert.equal(sheetsParameters.sheetName.value, "Sheet1");
  assert.deepEqual(Object.keys(sheetsParameters.columns.value), [
    "submittedAt",
    "studentId",
    "studentName",
    "email",
    "courseName",
    "rating",
    "feedbackMessage",
    "feedbackStatus",
  ]);
});

test("admin webhook requires header authentication and reads all sheet feedback", () => {
  const webhook = nodes.get("Admin Feedback Webhook").parameters;
  const reader = nodes.get("Read Feedback from Google Sheets").parameters;
  assert.equal(webhook.httpMethod, "GET");
  assert.equal(webhook.authentication, "headerAuth");
  assert.equal(reader.operation, "read");
  assert.equal(reader.sheetName.value, "Sheet1");
  assert.equal(
    workflow.connections["Admin Feedback Webhook"].main[0][0].node,
    "Read Feedback from Google Sheets",
  );
});

test("webhook response mode is compatible with n8n Respond to Webhook nodes", () => {
  assert.equal(
    nodes.get("Receive Feedback").parameters.responseMode,
    "responseNode",
  );
});

test("the workflow confirms a sheet append even if the thank-you email fails", () => {
  assert.equal(
    workflow.connections["Append to Google Sheets"].main[0][0].node,
    "Send Thank-you Email",
  );
  assert.equal(nodes.get("Send Thank-you Email").onError, "continueRegularOutput");
  assert.equal(
    workflow.connections["Send Thank-you Email"].main[0][0].node,
    "Confirm Submission",
  );
});
