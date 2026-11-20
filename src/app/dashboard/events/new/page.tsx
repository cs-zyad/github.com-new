import { EventForm } from "@/components/EventForm";
import { PageHeader } from "@/components/ui";
import { createEventAction } from "@/app/actions/events";
import { dateToLocalInput } from "@/lib/format";

export const metadata = { title: "فعالية جديدة" };

export default function NewEventPage() {
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  nextWeek.setUTCHours(16, 0, 0, 0); // 7 مساءً بتوقيت الرياض
  return (
    <div>
      <PageHeader
        title="فعالية جديدة"
        subtitle="تُحفظ كمسودة. بعدها تختار القالب وتضيف المدعوين وتراجع المعاينة ثم تدفع الباقة."
        back={{ href: "/dashboard", label: "الفعاليات" }}
      />
      <EventForm
        action={createEventAction}
        submitLabel="حفظ المسودة والمتابعة"
        defaults={{ mode: "PRIVATE", fullPolicy: "CLOSE", capacity: "50", startsAt: dateToLocalInput(nextWeek) }}
      />
    </div>
  );
}
