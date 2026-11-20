import { requireUser } from "@/lib/auth";
import { getOwnedEvent } from "@/services/events";
import { EventForm } from "@/components/EventForm";
import { updateEventAction } from "@/app/actions/events";
import { dateToLocalInput } from "@/lib/format";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const e = await getOwnedEvent(id, user.id);
  return (
    <EventForm
      action={updateEventAction}
      submitLabel="حفظ التعديلات"
      lockMode={e.paidPlaces > 0}
      defaults={{
        eventId: e.id,
        title: e.title,
        hostName: e.hostName,
        description: e.description,
        startsAt: dateToLocalInput(e.startsAt, e.timezone),
        endsAt: dateToLocalInput(e.endsAt, e.timezone),
        venueName: e.venueName,
        venueAddress: e.venueAddress,
        mapUrl: e.mapUrl ?? "",
        mode: e.mode,
        capacity: String(e.capacity),
        fullPolicy: e.fullPolicy,
      }}
    />
  );
}
