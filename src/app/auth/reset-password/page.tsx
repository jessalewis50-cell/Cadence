"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const router   = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 6)  { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) { setError(error.message); return; }
    router.push("/today");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-violet to-magenta grid place-items-center font-grotesk font-bold text-white text-2xl shadow-lg">
            C
          </div>
        </div>

        <h1 className="font-grotesk font-bold text-3xl text-center text-txt mb-1">New password</h1>
        <p className="text-muted text-sm text-center mb-8">Choose a password you&apos;ll remember</p>

        {error && (
          <div className="mb-4 px-4 py-3 bg-magenta/10 border border-magenta/30 rounded-xl text-magenta text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoFocus
            className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-txt placeholder:text-faint outline-none focus:border-violet transition-colors"
          />
          <input
            type="password"
            placeholder="Confirm new password"
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
            {loading ? "Saving…" : "Set new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
