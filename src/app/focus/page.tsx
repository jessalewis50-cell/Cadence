import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getMockData } from "@/lib/mock-data";
import NavRail from "@/components/layout/NavRail";
import LogoutButton from "@/components/layout/LogoutButton";
import FocusView from "@/components/focus/FocusView";
import type { ScheduleBlock, FocusSession } from "@/lib/types";

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function weekStartISO() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function FocusPage() {
  const cookieStore = await cookies();
  const supabase    = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isGuest = !user && cookieStore.get("cadence_guest")?.value === "true";

  let focusSessions: FocusSession[];
  let todayBlocks: ScheduleBlock[];
  let displayName: string;
  let userId: string | null = null;

  if (isGuest) {
    const mock  = getMockData();
    focusSessions = mock.focusSessions;
    todayBlocks   = mock.blocks;
    displayName   = "Jess";
  } else {
    if (!user) redirect("/login");
    userId      = user!.id;
    displayName = user!.email?.split("@")[0] ?? "there";
    const today = toDateStr(new Date());

    const [sessionsRes, blocksRes] = await Promise.all([
      supabase.from("focus_sessions").select("*").gte("started_at", weekStartISO()).order("started_at"),
      supabase.from("schedule_blocks").select("*").eq("day", today).order("position"),
    ]);

    focusSessions = sessionsRes.data ?? [];
    todayBlocks   = blocksRes.data ?? [];
  }

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="grid grid-cols-[74px_1fr] min-h-screen">
      <NavRail />
      <main className="px-8 py-7 pb-16 max-w-5xl w-full">
        <header className="flex items-start justify-between mb-7">
          <div>
            <h1 className="font-grotesk font-semibold text-[26px] tracking-tight text-txt">
              Focus
            </h1>
            <p className="text-muted text-[13.5px] mt-1">{dateLabel} · {displayName}</p>
          </div>
          <LogoutButton />
        </header>

        <FocusView
          focusSessions={focusSessions}
          todayBlocks={todayBlocks}
          isGuest={isGuest}
          userId={userId}
        />
      </main>
    </div>
  );
}
