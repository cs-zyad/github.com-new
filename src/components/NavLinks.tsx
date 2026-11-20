"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({
  items,
  className,
}: {
  items: { href: string; label: string; exact?: boolean }[];
  className: string;
}) {
  const pathname = usePathname();
  // أطول تطابق هو النشط
  const active = items
    .filter((i) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav className={className} aria-label="التنقل">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={active?.href === i.href ? "active" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
