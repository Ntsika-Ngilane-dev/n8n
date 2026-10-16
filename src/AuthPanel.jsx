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
  const [stage, setStage] = useState("form");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [googleCredential, setGoogleCredential] = useState("");
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
            if (result.user) {
              onAuthenticated(result.user);
            } else {
              setGoogleCredential(result.credential);
              setForm((current) => ({
                ...current,
                name: result.name,
                email: result.email,
              }));
              setStage("google-phone");
            }
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
        const result = await request("/api/auth/signup/start", form);
        setChallengeId(result.challengeId);
        setStage("verify");
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function startGooglePhoneVerification(event) {
    event.preventDefault();
    setMessage("");
    setIsBusy(true);
    try {
      const result = await request("/api/auth/google/start", {
        credential: googleCredential,
        phone: form.phone,
      });
      if (result.user) {
        onAuthenticated(result.user);
      } else {
        setChallengeId(result.challengeId);
        setStage("verify");
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setMessage("");
    setIsBusy(true);
    try {
      const result = await request("/api/auth/whatsapp/verify", { challengeId, code });
      onAuthenticated(result.user);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  function returnToForm(nextMode = mode) {
    setMode(nextMode);
    setStage("form");
    setChallengeId("");
    setCode("");
    setGoogleCredential("");
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
          <span><b>02</b> A quick WhatsApp phone check</span>
          <span><b>03</b> A real response from our learning team</span>
        </div>
      </div>

      <section className="auth-card">
        {stage === "form" && (
          <>
            <p className="card-kicker">NORTHSTAR LEARNING</p>
            <h2 id="auth-title">{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="auth-subtitle">
              {mode === "signin"
                ? "Sign in to continue to your student space."
                : "Your phone will be verified with a WhatsApp code."}
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
              {mode === "signup" && (
                <div className="field">
                  <label htmlFor="auth-phone">WhatsApp number</label>
                  <input id="auth-phone" name="phone" type="tel" autoComplete="tel" placeholder="+14155552671" pattern="\\+[1-9][0-9]{7,14}" value={form.phone} onChange={update} required />
                  <span className="field-hint">Use international format, including your country code.</span>
                </div>
              )}
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
          </>
        )}

        {stage === "google-phone" && (
          <>
            <p className="card-kicker">ONE MORE STEP</p>
            <h2 id="auth-title">Verify your phone</h2>
            <p className="auth-subtitle">Google account: {form.email}. Add a WhatsApp number to finish setting up your account.</p>
            <form onSubmit={startGooglePhoneVerification}>
              <div className="field">
                <label htmlFor="google-phone">WhatsApp number</label>
                <input id="google-phone" name="phone" type="tel" autoComplete="tel" placeholder="+14155552671" pattern="\\+[1-9][0-9]{7,14}" value={form.phone} onChange={update} required />
                <span className="field-hint">Use international format, including your country code.</span>
              </div>
              {message && <p className="auth-message" role="alert">{message}</p>}
              <button className="submit-button" type="submit" disabled={isBusy}>
                {isBusy ? "Sending code…" : "Send WhatsApp code"}
              </button>
            </form>
            <button className="back-link" onClick={() => returnToForm("signin")}>← Back to sign in</button>
          </>
        )}

        {stage === "verify" && (
          <>
            <p className="card-kicker">PHONE VERIFICATION</p>
            <h2 id="auth-title">Check WhatsApp</h2>
            <p className="auth-subtitle">Enter the verification code we sent to {form.phone || "your WhatsApp number"}.</p>
            <form onSubmit={verifyCode}>
              <div className="field">
                <label htmlFor="whatsapp-code">Verification code</label>
                <input id="whatsapp-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}" maxLength="10" value={code} onChange={(event) => setCode(event.target.value)} required />
              </div>
              {message && <p className="auth-message" role="alert">{message}</p>}
              <button className="submit-button" type="submit" disabled={isBusy}>
                {isBusy ? "Verifying…" : "Verify and continue"}
                {!isBusy && <span aria-hidden="true">→</span>}
              </button>
            </form>
            <button className="back-link" onClick={() => returnToForm("signup")}>← Back</button>
          </>
        )}
      </section>
    </section>
  );
}

export default AuthPanel;
