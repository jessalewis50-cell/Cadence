import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/components/layout/LogoutButton";
import { createClient } from "@/lib/supabase-server";
import { getMockData } from "@/lib/mock-data";
import { toDateStr } from "@/lib/time";
import TodayClient from "@/components/TodayClient";
import NavRail from "@/components/layout/NavRail";
import type { ScheduleBlock, Habit, HabitLog, FocusSession, DailyDebrief, DailyInsight } from "@/lib/types";

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDateStr(d);
}

function weekStartISO() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "day" } = await searchParams;

  const cookieStore = await cookies();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isGuest = !user && cookieStore.get("cadence_guest")?.value === "true";

  let blocks: ScheduleBlock[];
  let habits: Habit[];
  let habitLogs: HabitLog[];
  let focusSessions: FocusSession[];
  let displayName: string;
  let userId: string | null = null;
  let todayInsight: DailyInsight | null = null;
  let hasDebrief = false;

  if (isGuest) {
    const mock = getMockData();
    blocks = mock.blocks;
    habits = mock.habits;
    habitLogs = mock.habitLogs;
    focusSessions = mock.focusSessions;
    displayName = "Jess";
  } else {
    if (!user) redirect("/login");

    userId = user!.id;
    displayName = user!.email?.split("@")[0] ?? "there";
    const today = toDateStr(new Date());

    const [blocksRes, habitsRes, logsRes, sessionsRes, insightRes, debriefRes] = await Promise.all([
      supabase
        .from("schedule_blocks")
        .select("*")
        .eq("day", today)
        .order("position"),
      supabase
        .from("habits")
        .select("*")
        .eq("archived", false)
        .order("position"),
      supabase.from("habit_logs").select("*").gte("day", thirtyDaysAgo()),
      supabase
        .from("focus_sessions")
        .select("*")
        .gte("started_at", weekStartISO()),
      supabase
        .from("daily_insights")
        .select("*")
        .eq("generated_at", today)
        .maybeSingle(),
      supabase
        .from("daily_debriefs")
        .select("id")
        .eq("day", today)
        .maybeSingle(),
    ]);

    blocks        = blocksRes.data ?? [];
    habits        = habitsRes.data ?? [];
    habitLogs     = logsRes.data ?? [];
    focusSessions = sessionsRes.data ?? [];
    todayInsight  = (insightRes.data as DailyInsight | null) ?? null;
    hasDebrief    = !!debriefRes.data;
  }

  const h = new Date().getHours();
  const greeting =
    h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="grid grid-cols-[74px_1fr] min-h-screen">
      <NavRail />

      <main className="px-8 py-7 pb-16 w-full">
        <header className="flex items-end justify-between flex-wrap gap-5 mb-7">
          <div>
            <h1 className="font-grotesk font-semibold text-[26px] tracking-tight text-txt">
              {greeting}, {displayName}
            </h1>
            <p className="text-muted text-[13.5px] mt-1">{dateLabel}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-panel border border-line rounded-xl p-1">
              {(["day", "week", "month"] as const).map((p) => (
                <Link
                  key={p}
                  href={`/today${p !== "day" ? `?period=${p}` : ""}`}
                  className={`px-4 py-1.5 rounded-lg text-[13px] font-medium capitalize transition-colors ${
                    period === p
                      ? "bg-violet text-white"
                      : "text-muted hover:text-txt"
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Link>
              ))}
            </div>
            <LogoutButton />
          </div>
        </header>

        <TodayClient
          initialBlocks={blocks}
          habits={habits}
          allLogs={habitLogs}
          focusSessions={focusSessions}
          isGuest={isGuest}
          userId={userId}
          period={period}
          todayInsight={todayInsight}
          hasDebrief={hasDebrief}
        />
      </main>
    </div>
  );
}
