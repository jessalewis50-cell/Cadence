import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getMockData } from "@/lib/mock-data";
import { toDateStr } from "@/lib/time";
import NavRail from "@/components/layout/NavRail";
import LogoutButton from "@/components/layout/LogoutButton";
import BlocksView from "@/components/blocks/BlocksView";
import type { BlockTemplate, ScheduleBlock } from "@/lib/types";

function getWeekBounds() {
  const today  = new Date();
  const day    = today.getDay();
  const diff   = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toDateStr(monday), end: toDateStr(sunday) };
}

export default async function GoalsPage() {
  const cookieStore = await cookies();
  const supabase    = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isGuest = !user && cookieStore.get("cadence_guest")?.value === "true";

  if (!user && !isGuest) redirect("/login");

  let templates: BlockTemplate[];
  let weekBlocks: ScheduleBlock[];
  let userId: string | null = null;
  const { start: weekStart, end: weekEnd } = getWeekBounds();

  if (isGuest) {
    const mock = getMockData();
    templates  = mock.templates;
    weekBlocks = mock.blocks;
  } else {
    userId = user!.id;

    const [tplRes, blocksRes] = await Promise.all([
      supabase.from("block_templates").select("*").order("position"),
      supabase.from("schedule_blocks").select("*")
        .gte("day", weekStart).lte("day", weekEnd).order("start_time"),
    ]);

    templates  = tplRes.data ?? [];
    weekBlocks = blocksRes.data ?? [];
  }

  return (
    <div className="grid grid-cols-[74px_1fr] min-h-screen">
      <NavRail />

      <main className="px-6 py-7 pb-16 w-full">
        <header className="flex items-center justify-between mb-7">
          <h1 className="font-grotesk font-semibold text-[22px] tracking-tight text-txt">
            Plan your week
          </h1>
          <LogoutButton />
        </header>

        <BlocksView
          initialTemplates={templates}
          initialWeekBlocks={weekBlocks}
          isGuest={isGuest}
          userId={userId}
        />
      </main>
    </div>
  );
}
