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
  assert.equal(result.studentName, "Avery Student");
  assert.equal(result.rating, 5);
  assert.deepEqual(result.errors, []);
  assert.ok(Number.isFinite(Date.parse(result.submittedAt)));
});

test("workflow rejects missing, malformed, non-text, and oversized fields", () => {
  const missing = validateSubmission({});
  assert.equal(missing.isValid, false);
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

test("webhook response mode is compatible with n8n Respond to Webhook nodes", () => {
  assert.equal(
    nodes.get("Receive Feedback").parameters.responseMode,
    "responseNode",
  );
});
