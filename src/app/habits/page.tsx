import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getMockData } from "@/lib/mock-data";
import NavRail from "@/components/layout/NavRail";
import LogoutButton from "@/components/layout/LogoutButton";
import HabitsView from "@/components/habits/HabitsView";
import type { Habit, HabitLog } from "@/lib/types";

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDateStr(d);
}

export default async function HabitsPage() {
  const cookieStore = await cookies();
  const supabase    = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isGuest = !user && cookieStore.get("cadence_guest")?.value === "true";

  let habits: Habit[];
  let habitLogs: HabitLog[];
  let displayName: string;
  let userId: string | null = null;

  if (isGuest) {
    const mock = getMockData();
    habits    = mock.habits;
    habitLogs = mock.habitLogs;
    displayName = "Jess";
  } else {
    if (!user) redirect("/login");
    userId      = user!.id;
    displayName = user!.email?.split("@")[0] ?? "there";

    const [habitsRes, logsRes] = await Promise.all([
      supabase.from("habits").select("*").eq("archived", false).order("position"),
      supabase.from("habit_logs").select("*").gte("day", thirtyDaysAgo()),
    ]);

    habits    = habitsRes.data ?? [];
    habitLogs = logsRes.data ?? [];
  }

  const todayStr  = toDateStr(new Date());
  const todayLogs = habitLogs.filter((l) => l.day === todayStr);
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="grid grid-cols-[74px_1fr] min-h-screen">
      <NavRail />
      <main className="px-8 py-7 pb-16 w-full">
        <header className="flex items-start justify-between mb-7">
          <div>
            <h1 className="font-grotesk font-semibold text-[26px] tracking-tight text-txt">
              Habits
            </h1>
            <p className="text-muted text-[13.5px] mt-1">{dateLabel} · {displayName}</p>
          </div>
          <LogoutButton />
        </header>

        <HabitsView
          initialHabits={habits}
          initialTodayLogs={todayLogs}
          allLogs={habitLogs}
          isGuest={isGuest}
          userId={userId}
        />
      </main>
    </div>
  );
}
