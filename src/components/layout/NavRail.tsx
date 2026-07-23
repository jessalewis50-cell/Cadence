"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/today",
    title: "Today",
    // Sun — reads as "the current day" without colliding with the calendar
    // (now on Schedule), Habits' checkmark, or the focus timer's clock.
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
      </svg>
    ),
  },
  {
    // Label + icon only — the route and page content are unchanged.
    href: "/goals",
    title: "Schedule",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M3 10h18M8 2v4M16 2v4"/>
      </svg>
    ),
  },
  {
    href: "/habits",
    title: "Habits",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    ),
  },
  {
    href: "/progress",
    title: "Progress",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 20h18M7 16v-5M12 16V7M17 16v-8"/>
      </svg>
    ),
  },
];

export default function NavRail() {
  const pathname = usePathname();

  return (
    <aside className="border-r border-line sticky top-0 h-screen flex flex-col items-center gap-6 py-5">
      <div className="w-10 h-10 rounded-xl bg-linear-to-br from-violet to-magenta grid place-items-center font-grotesk font-bold text-white text-xl select-none">
        C
      </div>
      <nav className="flex flex-col gap-3 mt-1">
        {NAV_ITEMS.map(({ href, title, icon }) => {
          const active = pathname === href || pathname.startsWith(href + "?");
          return (
            <Link
              key={href}
              href={href}
              title={title}
              className={`w-11 h-11 rounded-xl border grid place-items-center transition-colors ${
                active
                  ? "border-line bg-panel text-txt"
                  : "border-transparent text-faint hover:bg-panel hover:text-txt"
              }`}
            >
              {icon}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
