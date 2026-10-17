import React, { useEffect, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

async function request(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "The request could not be completed.");
  return result;
}

function AuthPanel({ onAuthenticated, initialError }) {
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [message, setMessage] = useState(initialError);
  const [isBusy, setIsBusy] = useState(false);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return undefined;
    let isActive = true;
    const renderGoogleButton = () => {
      if (!isActive || !window.google?.accounts?.id || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setMessage("");
          setIsBusy(true);
          try {
            const result = await request("/api/auth/google", { credential });
            onAuthenticated(result.user);
          } catch (error) {
            setMessage(error.message);
          } finally {
            setIsBusy(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: "continue_with",
        width: Math.min(380, googleButtonRef.current.clientWidth || 380),
      });
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = renderGoogleButton;
      script.onerror = () => setMessage("Google sign-in could not be loaded.");
      document.head.appendChild(script);
    }
    return () => {
      isActive = false;
    };
  }, [onAuthenticated]);

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (message) setMessage("");
  }

  async function submitPasswordForm(event) {
    event.preventDefault();
    setMessage("");
    setIsBusy(true);
    try {
      if (mode === "signin") {
        const result = await request("/api/auth/signin", {
          email: form.email,
          password: form.password,
        });
        onAuthenticated(result.user);
      } else {
        const result = await request("/api/auth/signup", form);
        onAuthenticated(result.user);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  function returnToForm(nextMode = mode) {
    setMode(nextMode);
    setMessage("");
  }

  return (
    <section className="auth-layout" aria-labelledby="auth-title">
      <div className="auth-welcome">
        <p className="eyebrow"><span /> A BETTER WAY TO LEARN</p>
        <h1>Make your<br />experience count.</h1>
        <p className="intro-copy">
          Sign in to share course feedback and help shape a better learning
          experience for everyone.
        </p>
        <div className="auth-trust-list">
          <span><b>01</b> Your feedback, securely linked to you</span>
          <span><b>02</b> Share thoughtful, honest feedback</span>
          <span><b>03</b> A real response from our learning team</span>
        </div>
      </div>

      <section className="auth-card">
        <p className="card-kicker">NORTHSTAR LEARNING</p>
        <h2 id="auth-title">{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
        <p className="auth-subtitle">
          {mode === "signin"
            ? "Sign in to continue to your student space."
            : "Create an account to share your course feedback."}
        </p>
        {GOOGLE_CLIENT_ID ? (
          <div className="google-button-frame" ref={googleButtonRef} />
        ) : (
          <p className="google-config-note">Google sign-in is available after a client ID is configured.</p>
        )}
        <div className="auth-divider"><span>or continue with email</span></div>

        <form onSubmit={submitPasswordForm}>
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="signup-name">Full name</label>
              <input id="signup-name" name="name" autoComplete="name" minLength="2" maxLength="100" value={form.name} onChange={update} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Email address</label>
            <input id="auth-email" name="email" type="email" autoComplete="email" maxLength="254" value={form.email} onChange={update} required />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 12 : undefined} maxLength="256" value={form.password} onChange={update} required />
            {mode === "signup" && <span className="field-hint">Use at least 12 characters. Your password is stored as a secure hash.</span>}
          </div>
          {message && <p className="auth-message" role="alert">{message}</p>}
          <button className="submit-button" type="submit" disabled={isBusy}>
            {isBusy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            {!isBusy && <span aria-hidden="true">→</span>}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "signin" ? "New to Northstar?" : "Already have an account?"}{" "}
          <button onClick={() => returnToForm(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </section>
  );
}

export default AuthPanel;
