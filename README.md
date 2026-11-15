# Student Feedback

A React feedback form with Firebase email/password and Google sign-in. Submitted feedback is sent to an n8n workflow, which validates it, appends it to Google Sheets, assigns a status based on the rating, and sends a thank-you email.

## Run locally

1. Install Node.js 22 or later and run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET` to a random secret of at least 32 characters. In PowerShell, generate one with:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

4. Configure Firebase Authentication and copy the Firebase Web app settings as described below.
5. Set `N8N_WEBHOOK_URL` to the n8n webhook test URL while listening for a test event, or to the production URL after activating the workflow.
6. In one terminal run `npm run server`; in another run `npm run dev`. Open the Vite URL.
7. Run `npm test` and `npm run build` to validate the application.

The Vite development server proxies `/api` requests to the local API on port 3001.

## Data and accounts

- Firebase Authentication manages email/password accounts and Google sign-in. Email/password accounts must verify their email before signing in.
- The API verifies Firebase ID tokens and sets an eight-hour, signed, `HttpOnly` session cookie. Passwords are never stored in the app or Google Sheets.
- The app has no separate user database, lecturer/admin roles, review dashboard, or analytics dashboard.
- Feedback is stored in the Google Sheet configured in n8n. The API does not save a separate local or PostgreSQL copy.
- Each Sheet row contains the verified student's name and email, course name, rating, feedback message, status, and workflow submission timestamp. The Submit button is an action, not a stored field.
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

   `submittedAt | studentName | email | courseName | rating | feedbackMessage | feedbackStatus`

3. In Google Cloud, enable the Google Sheets API, Google Drive API, and Gmail API. Configure the OAuth consent screen and add the redirect URI shown by the n8n credentials.
4. In n8n, create and authorize Google Sheets OAuth2 and Gmail OAuth2 credentials. Select them in the **Append to Google Sheets** and **Send Thank-you Email** nodes. Keep client secrets in n8n's credential store.
5. Replace `REPLACE_WITH_GOOGLE_SHEET_ID` in the Sheets node with the ID of your spreadsheet and select the `Sheet1` tab.
6. Activate the workflow. Set `N8N_WEBHOOK_URL` to its production webhook URL for deployment; use the test URL only while the workflow is listening for a test event.

The workflow validates required fields, email format, text lengths, and an integer rating from 1 to 5. Ratings 1–2 are marked **Needs follow-up**; ratings 3–5 are marked **Positive**. The Sheet append happens before the thank-you email. If Gmail fails, the workflow still confirms the saved submission; if the Sheet append or workflow fails, the app displays an error instead of claiming the feedback was saved.

## Deploy to Vercel

The Vercel deployment uses the React build and serverless API under `api/`; it does not run `server/index.js`. Configure these environment variables in the Vercel project:

- `SESSION_SECRET` — random secret of at least 32 characters.
- `FIREBASE_API_KEY` — Firebase Web app API key used by the server to verify ID tokens.
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` — Firebase Web app configuration used in the client build; these values are public.
- `N8N_WEBHOOK_URL` — the active n8n production webhook URL.

No PostgreSQL, SQLite, service-account key, or separate application database is required. After changing environment variables, redeploy so they take effect.

## Loom walkthrough and reflection

Record a short walkthrough after configuring Google OAuth and the n8n integrations:

- Demonstrate account creation with email verification, Google sign-in, and a feedback submission.
- Show the n8n canvas, explain each node, and show the corresponding Google Sheets row and thank-you email.
- Include a screenshot of the workflow.

Reflection prompts:

- **What challenges did you encounter?** Consider matching form and workflow field names and configuring Google OAuth credentials.
- **How did you solve them?** Explain how you verified the Google session, validated workflow inputs, and tested the rating branches.
- **What did you learn about workflow automation?** Describe how the webhook, validation, conditional status, Sheet append, and email fit together.
