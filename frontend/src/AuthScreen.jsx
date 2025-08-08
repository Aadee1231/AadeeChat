// src/AuthScreen.jsx
import { useState } from "react";
import { supabase } from "./supabase";

export default function AuthScreen() {
  const [mode, setMode] = useState("sign_in"); // 'sign_in' | 'sign_up'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    try {
      if (mode === "sign_in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg("Signed in!");
      } else {
        // IMPORTANT: include emailRedirectTo so the link returns to your app
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;

        // If confirm-email is ON, you'll get data.user with no session and an email will be sent
        // If it's OFF, you'll get a session immediately (no email sent, by design)
        if (!data.session) {
          setMsg("Check your email to confirm your account. Didn’t get it? Click 'Resend confirmation'.");
        } else {
          setMsg("Account created and signed in (email confirmation disabled).");
        }
      }
    } catch (err) {
      setMsg(err?.message || "Something went wrong.");
      console.error("Auth error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function resendConfirmation() {
    if (!email) return setMsg("Enter your email first, then click Resend.");
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMsg("Confirmation email resent. Check your inbox/spam.");
    } catch (err) {
      setMsg(err?.message || "Could not resend confirmation.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (!email) return setMsg("Enter your email first.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setMsg(error ? error.message : "Password reset email sent.");
  }

  return (
    <div style={styles.wrap}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h2 style={{ marginBottom: 8 }}>AadeeChat</h2>
        <p style={{ color: "#64748b", marginTop: 0, marginBottom: 20 }}>
          {mode === "sign_in" ? "Sign in to your account" : "Create an account"}
        </p>

        <input
          style={styles.input}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          style={styles.input}
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button style={styles.btn} type="submit" disabled={loading}>
          {loading ? "Please wait..." : mode === "sign_in" ? "Sign In" : "Sign Up"}
        </button>

        {mode === "sign_up" && (
          <button type="button" onClick={resendConfirmation} style={styles.link} disabled={loading}>
            Resend confirmation
          </button>
        )}

        <button
          type="button"
          onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
          style={styles.link}
        >
          {mode === "sign_in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>

        <button type="button" onClick={resetPassword} style={styles.link}>
          Forgot password?
        </button>

        {msg && <div style={{ marginTop: 10, color: "#ef4444" }}>{msg}</div>}
      </form>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#f8fafc",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 8px 24px rgba(15,23,42,.06)",
    display: "grid",
    gap: 10,
  },
  input: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    fontSize: 16,
  },
  btn: {
    padding: "10px 14px",
    borderRadius: 999,
    border: "none",
    background: "#111827",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 6,
  },
  link: {
    background: "transparent",
    border: "none",
    color: "#2563eb",
    textAlign: "left",
    padding: 4,
    cursor: "pointer",
  },
};
