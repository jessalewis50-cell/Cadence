"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function LogoutButton() {
  const router   = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    document.cookie = "cadence_guest=; path=/; max-age=0";
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      title="Sign out"
      className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-muted border border-line rounded-lg hover:border-violet hover:text-txt transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      Sign out
    </button>
  );
}
