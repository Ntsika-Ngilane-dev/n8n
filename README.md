# Student Feedback

A React feedback form with Firebase email/password and Google sign-in. Submitted feedback is sent to an n8n workflow, which validates it, appends it to Google Sheets, assigns a status based on the rating, and sends a thank-you email.

## Run locally

1. Install Node.js 22 or later and run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET` to a random secret of at least 32 characters. In PowerShell, generate one with:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

4. Set `ADMIN_EMAILS` to the verified Firebase email address that should have admin access.
5. Configure Firebase Authentication and copy the Firebase Web app settings as described below.
6. Set `N8N_WEBHOOK_URL` to the n8n webhook test URL while listening for a test event, or to the production URL after activating the workflow.
7. In one terminal run `npm run server`; in another run `npm run dev`. Open the Vite URL.
8. Run `npm test` and `npm run build` to validate the application.

The Vite development server proxies `/api` requests to the local API on port 3001.

## Data and accounts

- Firebase Authentication manages email/password accounts and Google sign-in. Email/password accounts must verify their email before signing in.
- The API verifies Firebase ID tokens and sets an eight-hour, signed, `HttpOnly` session cookie. Passwords are never stored in the app or Google Sheets.
- `ADMIN_EMAILS` is a comma-separated server-side allowlist of verified Firebase account emails. Allowlisted accounts get an admin dashboard; everyone else remains a student. The role is derived from the verified email on the server and is not accepted from the browser.
- Feedback is stored in the Google Sheet configured in n8n. The API does not save a separate local or PostgreSQL copy.
- Each new Sheet row contains the verified Firebase UID, student name and email, course name, rating, feedback message, status, and workflow submission timestamp. The UID keeps submissions linked to the account even if the student changes their display name. The Submit button is an action, not a stored field.
- The admin dashboard shows all feedback cards, the overall average rating, low-rating count, monthly submission trend, and per-student submission milestones (first, fifth, and tenth submission). It reports feedback participation only; the app does not collect course completion or learning-progress data.
- Admin feedback is read through the server and a separate n8n webhook protected by a Header Auth credential. The webhook token is never sent to the browser. Existing Sheet rows without a Firebase UID remain visible and are grouped by email for milestone counts.
- Existing records in a previous SQLite or PostgreSQL database are not automatically migrated to Google Sheets.

## Configure Firebase Authentication

1. In the Firebase console, add Firebase to your Google Cloud project (or create a Firebase project) and register a Web app.
2. In **Authentication → Sign-in method**, enable **Email/Password** and **Google**. Add `localhost` and your deployed app domain to the authorized domains.
3. Copy the Web app's API key, Auth domain, project ID, and app ID into `.env`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
4. Set `FIREBASE_API_KEY` to the same public Firebase API key. The server uses it to verify ID tokens with Firebase; no service-account key is needed.
5. Set `SESSION_SECRET` to a random secret of at least 32 characters. Do not use the Google OAuth client secret in the app or commit it.

## Configure n8n and Google Sheets

1. Import [`n8n/feedback-workflow.json`](./n8n/feedback-workflow.json) into n8n.
2. Use a sheet tab named `Sheet1` and add this header row in row 1:

   `submittedAt | studentId | studentName | email | courseName | rating | feedbackMessage | feedbackStatus`

3. In Google Cloud, enable the Google Sheets API, Google Drive API, and Gmail API. Configure the OAuth consent screen and add the redirect URI shown by the n8n credentials.
4. In n8n, create and authorize Google Sheets OAuth2 and Gmail OAuth2 credentials. Select them in the **Append to Google Sheets**, **Read Feedback from Google Sheets**, and **Send Thank-you Email** nodes. Keep client secrets in n8n's credential store.
5. Create an n8n **Header Auth** credential for the **Admin Feedback Webhook**. Set its header name to `X-Admin-Token` and its value to a long random token. Store that same token as `N8N_ADMIN_WEBHOOK_TOKEN` on the server only.
6. Confirm both Google Sheets nodes target your spreadsheet and the `Sheet1` tab. For an existing sheet, add the `studentId` header after `submittedAt`; older rows remain readable.
7. Activate the workflow. Set `N8N_WEBHOOK_URL` to the feedback production webhook URL and `N8N_ADMIN_WEBHOOK_URL` to the admin read production webhook URL. Use test URLs only while the workflow is listening for test events.

The workflow validates required fields, email format, text lengths, and an integer rating from 1 to 5. Ratings 1–2 are marked **Needs follow-up**; ratings 3–5 are marked **Positive**. The Sheet append happens before the thank-you email. If Gmail fails, the workflow still confirms the saved submission; if the Sheet append or workflow fails, the app displays an error instead of claiming the feedback was saved.

## Deploy to Vercel

The Vercel deployment uses the React build and serverless API under `api/`; it does not run `server/index.js`. Configure these environment variables in the Vercel project:

- `SESSION_SECRET` — random secret of at least 32 characters.
- `FIREBASE_API_KEY` — Firebase Web app API key used by the server to verify ID tokens.
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` — Firebase Web app configuration used in the client build; these values are public.
- `N8N_WEBHOOK_URL` — the active n8n production webhook URL.
- `ADMIN_EMAILS` — comma-separated allowlist; add the verified Firebase email address that should have admin access.
- `N8N_ADMIN_WEBHOOK_URL` — the active protected n8n admin-read production webhook URL.
- `N8N_ADMIN_WEBHOOK_TOKEN` — the same secret value configured in the n8n Header Auth credential. Never use a `VITE_` prefix for this token.

No PostgreSQL, SQLite, service-account key, or separate application database is required. After changing environment variables, redeploy so they take effect. Admin allowlist changes take effect on the next API request.

## Loom walkthrough and reflection

Record a short walkthrough after configuring Google OAuth and the n8n integrations:

- Demonstrate account creation with email verification, Google sign-in, and a feedback submission.
- Show the n8n canvas, explain each node, and show the corresponding Google Sheets row and thank-you email.
- Include a screenshot of the workflow.

Reflection prompts:

- **What challenges did you encounter?** Consider matching form and workflow field names and configuring Google OAuth credentials.
- **How did you solve them?** Explain how you verified the Google session, validated workflow inputs, and tested the rating branches.
- **What did you learn about workflow automation?** Describe how the webhook, validation, conditional status, Sheet append, and email fit together.
