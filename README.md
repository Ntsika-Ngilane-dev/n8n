# Student Feedback

A React feedback form with a Node API, persistent SQLite storage, Google sign-in, password accounts, and lecturer/administrator review dashboards. Passwords are stored as salted `scrypt` hashes, never as plain text. Feedback is stored in the local application database and forwarded to the n8n workflow, which appends it to Google Sheets and sends the student an email.

## Run locally

1. Install Node.js 22 or later and run `npm install`.
2. Copy `.env.example` to `.env`. Vite and the API both read this file.
3. Set `SESSION_SECRET` to a random secret of at least 32 characters. For PowerShell, generate one with:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

4. Configure the Google and n8n values described below.
5. In one terminal, run `npm run server`. In another, run `npm run dev` and open the Vite URL. The Vite development server proxies `/api` requests to the API on port 3001.
6. Run `npm test` to check password hashing, input format validation, and persisted session behavior.

The API creates its SQLite database and session store under `data/`. These files are ignored by Git and should be backed up and protected like other account data.

## Google sign-in

1. Create a Google OAuth 2.0 **Web application** client in Google Cloud Console.
2. Add the local Vite origin (normally `http://localhost:5173`) to **Authorized JavaScript origins**. Add the deployed web-app origin for production.
3. Set both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` in `.env` to that OAuth client ID.

Google Identity Services authenticates existing Google-linked accounts and creates new accounts after Google verifies the email address. A verified Google email matching an existing password account can link to that account.

## Accounts and roles

- **Students** can sign up with email/password or Google, then submit feedback. The API takes the student name and email from the authenticated session rather than trusting form input.
- **Lecturers** use the same sign-in flow. Set `LECTURER_COURSES` to a JSON mapping from lecturer email to their assigned course names. For example: `{"lee@example.com":["React Basics","UX Design"]}`. Lecturers can view and filter only feedback for those courses.
- **Lead lecturer / administrator accounts** can view all course reviews and an all-course overview with review totals, average ratings, and low-rating counts. They have broader access than lecturers, who are restricted to assigned courses. Bootstrap an administrator by setting `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_PASSWORD` before starting the API. The password must be at least 12 characters. The configured account is assigned the administrator role at startup. Additional trusted admin email addresses can be listed in `ADMIN_EMAILS` (comma-separated); they receive the admin role after Google sign-in verifies their email.

Keep role configuration and administrator credentials private. Do not put secrets in `VITE_` variables; Vite exposes those values to browsers. The Google client ID is public configuration, while the session secret and admin password must remain server-side.

## n8n, Google Sheets, and Gmail

1. Import [`n8n/feedback-workflow.json`](./n8n/feedback-workflow.json) into n8n.
2. Create a Google Sheet with a tab named `Feedback` and this header row:

   `submittedAt | studentName | email | courseName | rating | feedbackMessage | feedbackStatus`

3. In Google Cloud, enable the Google Sheets API, Google Drive API, and Gmail API. Add the redirect URI shown by each n8n OAuth2 credential to the Google OAuth client and configure the OAuth consent screen/test users.
4. In n8n, create Google Sheets OAuth2 and Gmail OAuth2 credentials with the Google client ID and client secret. Authorize the Google account that can edit the sheet and send the thank-you emails. Keep the client secret in n8n's credential store; do not add it to `.env` or the workflow export.
5. Select the Google Sheets credential and spreadsheet/tab in **Append to Google Sheets**. Select the Gmail credential in **Send Thank-you Email**.
6. Activate the workflow and set `N8N_WEBHOOK_URL` in `.env` to its production webhook URL. For local testing, use the webhook test URL while the workflow is listening for a test event.

The application first saves a review to its SQLite database, then forwards it to n8n. If n8n or the email step is unavailable, the student is told the feedback was saved but automation did not complete; the local dashboard data remains available. Credentials and database files are not sent to n8n.

## Review dashboard

- The **Reviews** area displays student names, course names, ratings, messages, review status, and submission date.
- **Group by course** filters the list to one course. Clicking an administrator course summary applies that same filter.
- Administrators also see totals and course-level analytics.
- Lecturers see only their assigned courses. Configure assignments in `LECTURER_COURSES`; an empty assignment grants no review access.

## Workflow nodes

1. **Receive Feedback** — accepts a JSON `POST` at `/webhook/student-feedback`.
2. **Validate Feedback** — checks required values, email format, and integer rating from 1 to 5.
3. **Is Submission Valid?** — returns a JSON `400` for invalid requests.
4. **Rating 2 or Below?** — routes 1–2 to **Needs follow-up** and 3–5 to **Positive**.
5. **Append to Google Sheets** — stores the submission and status.
6. **Send Thank-you Email** — uses the connected Gmail account to acknowledge the student after the sheet append succeeds.
7. **Confirm Submission** — returns a success response to the API.

## Loom walkthrough and reflection

Record a short Loom walkthrough after configuring the external services:

- Demonstrate email/password sign-up, sign-in, and (if configured) Google sign-in.
- Show a student submitting a low rating and a higher rating.
- Show the administrator dashboard, course summaries, and course filter. If possible, sign in as a lecturer and show the limited assigned-course view.
- Show the n8n canvas, explain each node, then show the saved Google Sheets rows and thank-you email.
- Include a screenshot of the n8n workflow in your submitted documentation.

Reflection prompts:

- **What challenges did you encounter?** Consider matching front-end and workflow fields, configuring OAuth, and limiting review access by role.
- **How did you solve them?** Explain the API configuration and how you tested sign-up, rating branches, and lecturer course scope.
- **What did you learn about workflow automation?** Describe how identity, validation, conditional routing, storage, and notification work together.

https://console.cloud.google.com/auth/clients/815269896389-r4r1u9pqhuonnpcmhs659plohaii7k9o.apps.googleusercontent.com?organizationId=0&project=glassy-land-469613-n7