import { requireUser } from "@/lib/auth";
import { TopBar } from "@/components/Shell";

export const metadata = { title: "التحضير" };

export default async function CheckinLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <TopBar user={user} home="/checkin" />
      <main className="container" style={{ padding: "1rem 16px 3rem", maxWidth: 720 }}>
        {children}
      </main>
    </>
  );
}
