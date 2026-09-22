import { createFileRoute } from "@tanstack/react-router";
import { Cog } from "lucide-react";
import { AboutCard } from "@/components/about-card";
import { HealthCard } from "@/components/health-card";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/servo")({ component: ServoPage });

function ServoPage() {
  const { status, client, servos, selected } = useSession();
  const servo = status === "ready" ? servos.find((s) => s.id === selected) : undefined;
  if (client === undefined || servo === undefined) {
    return <p className="text-text-3">Pick a servo in the left pane.</p>;
  }
  return (
    <>
      <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold">
        <Cog className="size-5" />
        ID {servo.id}
      </h1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] gap-4">
        <AboutCard key={`about-${servo.id}`} client={client} id={servo.id} uid={servo.uid} />
        <HealthCard key={`health-${servo.id}`} client={client} id={servo.id} />
      </div>
    </>
  );
}
