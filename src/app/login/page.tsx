"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup" | "forgot";

export default function LoginPage() {
  const [mode, setMode]         = useState<Mode>("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);

  const router   = useRouter();
  const supabase = createClient();

  function reset() {
    setError(null);
    setInfo(null);
    setPassword("");
    setConfirm("");
  }

  function switchMode(m: Mode) {
    setMode(m);
    reset();
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) { setError(error.message); return; }
    router.push("/today");
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 6)  { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);

    if (error) { setError(error.message); return; }
    setInfo("Account created! Check your email to confirm, then sign in.");
    switchMode("signin");
  }

  // magic link removed — password auth only

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });
    setLoading(false);

    if (error) { setError(error.message); return; }
    setInfo(`Password reset link sent to ${email} — check your inbox.`);
  }

function handleGuest() {
    document.cookie = "cadence_guest=true; path=/; max-age=604800; SameSite=Strict";
    router.push("/today");
  }

  const TABS: { id: Mode; label: string }[] = [
    { id: "signin", label: "Sign in" },
    { id: "signup", label: "Sign up" },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-violet to-magenta grid place-items-center font-grotesk font-bold text-white text-2xl shadow-lg">
            C
          </div>
        </div>

        <h1 className="font-grotesk font-bold text-3xl text-center text-txt mb-1">Cadence</h1>
        <p className="text-muted text-sm text-center mb-8">Your daily productivity rhythm</p>

        {/* Mode tabs */}
        <div className="flex bg-panel border border-line rounded-xl p-1 mb-5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => switchMode(id)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                mode === id ? "bg-violet text-white" : "text-muted hover:text-txt"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Feedback banners */}
        {info && (
          <div className="mb-4 px-4 py-3 bg-cadence-green/10 border border-cadence-green/30 rounded-xl text-cadence-green text-sm">
            {info}
          </div>
        )}
        {error && (
          <div className="mb-4 px-4 py-3 bg-magenta/10 border border-magenta/30 rounded-xl text-magenta text-sm">
            {error}
          </div>
        )}

        {/* Sign in */}
        {mode === "signin" && (
          <form onSubmit={handleSignIn} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
              />
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="mt-1.5 ml-1 text-[12px] text-faint hover:text-violet transition-colors"
              >
                Forgot password?
              </button>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet text-white font-grotesk font-semibold rounded-xl py-3 hover:bg-[#6a59f5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {/* Forgot password */}
        {mode === "forgot" && (
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-3">
            <p className="text-muted text-sm">Enter your email and we&apos;ll send a reset link.</p>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet text-white font-grotesk font-semibold rounded-xl py-3 hover:bg-[#6a59f5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="text-[13px] text-faint hover:text-txt transition-colors text-center"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {/* Sign up */}
        {mode === "signup" && (
          <form onSubmit={handleSignUp} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet text-white font-grotesk font-semibold rounded-xl py-3 hover:bg-[#6a59f5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}

        {/* Guest */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-line" />
          <span className="text-faint text-xs">or</span>
          <div className="flex-1 h-px bg-line" />
        </div>
        <button
          type="button"
          onClick={handleGuest}
          className="w-full border border-line rounded-xl py-3 text-muted font-medium hover:border-violet hover:text-txt transition-colors"
        >
          Continue as guest
        </button>
      </div>
    </div>
  );
}
