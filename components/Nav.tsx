"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Library" },
  { href: "/lists", label: "Lists" },
  { href: "/chat", label: "Chat" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-base/85 backdrop-blur">
      <div className="mx-auto flex max-w-shell items-center justify-between px-5 py-3.5">
        {/* signature element: the serif wordmark with an ember mark */}
        <Link href="/" className="font-serif text-lg tracking-tight text-bone" aria-label="Crate — home">
          crate<span className="text-ember">.</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                prefetch
                className={`relative py-1 transition-colors duration-200 ease-quiet ${
                  active ? "text-bone" : "text-sand hover:text-bone"
                }`}
              >
                {l.label}
                {active && <span className="absolute -bottom-px left-0 h-px w-full bg-ember" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
