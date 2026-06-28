"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/today",
    title: "Today",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M3 10h18M8 2v4M16 2v4"/>
      </svg>
    ),
  },
  {
    href: "/goals",
    title: "Goals",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
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
