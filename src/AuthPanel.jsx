import React, { useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "./firebase.js";

function getAuthErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a password with at least 12 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a little and try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
    "auth/unauthorized-domain": "This site is not authorized in Firebase Authentication settings.",
    "auth/operation-not-allowed": "Enable this sign-in method in Firebase Authentication settings.",
    "auth/user-not-found": "No account was found for that email. Create an account first.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/network-request-failed": "Could not reach Firebase. Check your connection and try again.",
  };
  return messages[error.code] ?? error.message ?? "Authentication could not be completed.";
}

async function createAppSession(user) {
  const credential = await user.getIdToken();
  const response = await fetch("/api/auth/firebase", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message ?? "Sign-in could not be completed.");
  }
  return result;
}

function AuthPanel({ onAuthenticated, initialError }) {
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState(initialError);

  async function handleGoogleSignIn() {
    if (!firebaseAuth) return;
    setMessage("");
    setIsBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(firebaseAuth, provider);
      if (!result.user.emailVerified) {
        await signOut(firebaseAuth);
        setMessage("Google did not verify your email address. Try another account.");
        return;
      }
      const session = await createAppSession(result.user);
      onAuthenticated(session.user);
    } catch (error) {
      setMessage(getAuthErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!firebaseAuth || !event.currentTarget.reportValidity()) return;

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    const name = String(formData.get("name") ?? "").trim();

    setMessage("");
    setIsBusy(true);
    try {
      if (isCreatingAccount) {
        const account = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        await updateProfile(account.user, { displayName: name });
        await sendEmailVerification(account.user);
        await signOut(firebaseAuth);
        formElement.reset();
        setIsCreatingAccount(false);
        setMessage("Account created. Check your email and verify your address before signing in.");
        return;
      }

      const account = await signInWithEmailAndPassword(firebaseAuth, email, password);
      if (!account.user.emailVerified) {
        await sendEmailVerification(account.user);
        await signOut(firebaseAuth);
        setMessage("Verify your email before signing in. We sent you a new verification link.");
        return;
      }
      const session = await createAppSession(account.user);
      onAuthenticated(session.user);
    } catch (error) {
      if (firebaseAuth.currentUser) {
        try {
          await signOut(firebaseAuth);
        } catch (signOutError) {
          console.error("Could not clear the Firebase client session:", signOutError.message);
        }
      }
      setMessage(getAuthErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function toggleMode() {
    setMessage("");
    setIsCreatingAccount((current) => !current);
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
        <h2 id="auth-title">{isCreatingAccount ? "Create your account" : "Welcome back"}</h2>
        <p className="auth-subtitle">
          {isCreatingAccount
            ? "Create an account to share your course feedback."
            : "Sign in to continue to your student space."}
        </p>

        <button
          className="auth-google-button"
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isBusy || !firebaseAuth}
        >
          <svg aria-hidden="true" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5Z" transform="translate(0 5)" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.4-4.5 7.1l7.3 5.7c4.3-4 6.9-9.9 6.9-17.3Z" transform="translate(0 0)" />
            <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1Z" transform="translate(0 0)" />
            <path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.7 2.3-6.4 0-11.8-4.1-13.7-9.8l-7.8 6.1C6.5 43.6 14.6 48 24 48Z" transform="translate(0 0)" />
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or continue with email</span></div>

        <form onSubmit={handleSubmit}>
          {isCreatingAccount && (
            <div className="field">
              <label htmlFor="accountName">Full name</label>
              <input
                autoComplete="name"
                id="accountName"
                maxLength="100"
                name="name"
                required
                type="text"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="accountEmail">Email address</label>
            <input
              autoComplete="email"
              id="accountEmail"
              maxLength="254"
              name="email"
              required
              type="email"
            />
          </div>
          <div className="field">
            <label htmlFor="accountPassword">Password</label>
            <input
              autoComplete={isCreatingAccount ? "new-password" : "current-password"}
              id="accountPassword"
              minLength={isCreatingAccount ? 12 : undefined}
              name="password"
              required
              type="password"
            />
            {isCreatingAccount && (
              <small className="field-hint">Use at least 12 characters. Firebase securely manages your password.</small>
            )}
          </div>
          {!firebaseAuth && (
            <p className="google-config-note" role="status">
              Firebase Authentication is not configured for this deployment.
            </p>
          )}
          {message && <p className="auth-message" role="alert">{message}</p>}
          {isBusy && <p className="auth-subtitle" role="status">Please wait…</p>}
          <button className="submit-button auth-submit-button" type="submit" disabled={isBusy || !firebaseAuth}>
            {isCreatingAccount ? "Create account" : "Sign in"}
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="auth-switch">
          {isCreatingAccount ? "Already have an account?" : "New to Northstar?"}{" "}
          <button type="button" onClick={toggleMode} disabled={isBusy}>
            {isCreatingAccount ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>
    </section>
  );
}

export default AuthPanel;
