import Link from "next/link";
import { Logo } from "./Logo";
import { env } from "@/lib/env";
import type { CurrentUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import { NavLinks } from "./NavLinks";

export function DemoBanner() {
  if (!env.demoMode) return null;
  return (
    <div className="demo-banner">
      الوضع التجريبي: الرسائل والدفع محاكاة ولا تُرسل خارج المنصة — <Link href="/dev/inbox">صندوق الرسائل التجريبي</Link>
    </div>
  );
}

export function TopBar({ user, home = "/dashboard" }: { user: CurrentUser | null; home?: string }) {
  return (
    <>
      <DemoBanner />
      <header className="topbar">
        <div className="container">
          <Link href={home} className="brand" aria-label="الرئيسية">
            <Logo onDark size={28} />
          </Link>
          {user ? (
            <div className="user">
              <span className="name hide-mobile">{user.name}</span>
              <form action={logoutAction}>
                <button className="btn btn-sm btn-ghost" style={{ color: "var(--ivory)", borderColor: "rgba(255,255,255,.3)" }}>
                  خروج
                </button>
              </form>
            </div>
          ) : (
            <Link href="/login" className="btn btn-sm btn-primary">
              تسجيل الدخول
            </Link>
          )}
        </div>
      </header>
    </>
  );
}

export function AppShell({
  user,
  nav,
  children,
  home,
}: {
  user: CurrentUser;
  nav: { href: string; label: string; exact?: boolean }[];
  children: React.ReactNode;
  home?: string;
}) {
  return (
    <>
      <TopBar user={user} home={home} />
      <div className="container shell">
        <NavLinks items={nav} className="sidenav" />
        <main style={{ minWidth: 0 }}>{children}</main>
      </div>
    </>
  );
}
