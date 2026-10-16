import React, { useEffect, useState } from "react";
import AuthPanel from "./AuthPanel.jsx";
import StaffDashboard from "./StaffDashboard.jsx";

const initialForm = { courseName: "", rating: "", feedbackMessage: "" };

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message ?? "The request could not be completed.");
  }
  return body;
}

function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authError, setAuthError] = useState("");
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    apiRequest("/api/auth/me")
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((error) => setAuthError(error.message))
      .finally(() => setCheckingSession(false));
  }, []);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (status.message) setStatus({ type: "", message: "" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: "", message: "" });
    if (!event.currentTarget.reportValidity()) return;
    setIsSubmitting(true);
    try {
      const result = await apiRequest("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ ...form, rating: Number(form.rating) }),
      });
      setForm(initialForm);
      setStatus({
        type: result.automationPending ? "warning" : "success",
        message: result.message,
      });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signOut() {
    try {
      await apiRequest("/api/auth/signout", { method: "POST" });
      setUser(null);
      setForm(initialForm);
      setStatus({ type: "", message: "" });
    } catch (error) {
      setAuthError(error.message);
    }
  }

  if (checkingSession) {
    return (
      <main className="page-shell loading-shell">
        <p className="loading-message">Loading your secure session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page-shell">
        <SiteHeader />
        <AuthPanel
          onAuthenticated={setUser}
          initialError={authError}
          onErrorDismiss={() => setAuthError("")}
        />
        <SiteFooter />
      </main>
    );
  }

  if (user.role !== "student") {
    return (
      <main className="page-shell">
        <SiteHeader user={user} onSignOut={signOut} />
        <StaffDashboard user={user} />
        <SiteFooter />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <SiteHeader user={user} onSignOut={signOut} />
      <section className="content" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow"><span /> YOUR VOICE MATTERS</p>
          <h1 id="page-title">Help us make<br />learning better.</h1>
          <p className="intro-copy">
            A few honest words can make a big difference. Tell us how your
            course went — it only takes a minute.
          </p>
          <div className="trust-note">
            <span className="shield-icon" aria-hidden="true">✓</span>
            <span>Your feedback is shared with our learning team.</span>
          </div>
          <div className="decorative-orbit" aria-hidden="true">
            <span className="orbit-dot" />
            <span className="orbit-star">✳</span>
          </div>
        </div>

        <section className="form-card" aria-label="Course feedback form">
          <div className="card-heading">
            <div>
              <p className="card-kicker">COURSE FEEDBACK</p>
              <h2>Share your experience</h2>
              <p className="signed-in-as">Signed in as {user.name} · {user.email}</p>
            </div>
            <span className="time-badge">1 MIN</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="courseName">Course name</label>
              <input
                id="courseName"
                name="courseName"
                type="text"
                placeholder="e.g. Introduction to UX Design"
                maxLength="150"
                value={form.courseName}
                onChange={updateField}
                required
              />
            </div>

            <fieldset className="rating-field">
              <legend>How would you rate this course?</legend>
              <div className="rating-options">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <label
                    className={`rating-choice${Number(form.rating) === rating ? " selected" : ""}`}
                    key={rating}
                  >
                    <input
                      type="radio"
                      name="rating"
                      value={rating}
                      checked={Number(form.rating) === rating}
                      onChange={updateField}
                      required
                    />
                    <span>{rating}</span>
                  </label>
                ))}
              </div>
              <div className="rating-ends">
                <span>Not great</span>
                <span>Excellent</span>
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor="feedbackMessage">Your feedback</label>
              <textarea
                id="feedbackMessage"
                name="feedbackMessage"
                placeholder="What worked well? What could we improve?"
                rows="4"
                maxLength="2000"
                value={form.feedbackMessage}
                onChange={updateField}
                required
              />
              <span className="character-count">{form.feedbackMessage.length}/2000</span>
            </div>

            {status.message && (
              <p
                className={`form-status ${status.type}`}
                role={status.type === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                <span aria-hidden="true">{status.type === "success" ? "✓" : "!"}</span>
                {status.message}
              </p>
            )}

            <button className="submit-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending feedback..." : "Send my feedback"}
              {!isSubmitting && <span aria-hidden="true">→</span>}
            </button>
            <p className="privacy-note">
              Your feedback is associated with your verified student account.
            </p>
          </form>
        </section>
      </section>
      <SiteFooter />
    </main>
  );
}

function SiteHeader({ user, onSignOut }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Northstar Learning home">
        <span className="brand-mark" aria-hidden="true">N</span>
        <span>northstar<span className="brand-light"> learning</span></span>
      </a>
      <div className="topbar-actions">
        {user && (
          <>
            <span className="user-pill">
              <span className={`role-dot ${user.role}`} />
              {user.name} · {user.role === "admin" ? "Lead lecturer · Admin" : "Lecturer"}
            </span>
            <button className="signout-button" onClick={onSignOut}>Sign out</button>
          </>
        )}
        {!user && <span className="topbar-note">Student experience</span>}
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="footer">
      <span>© 2026 Northstar Learning</span>
      <span>Built around better learning.</span>
    </footer>
  );
}

export default App;
