import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "../lib/session";

export const Route = createFileRoute("/live")({ component: LivePage });

function LivePage() {
  const { status } = useSession();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Live</h1>
      {status !== "ready" && <p>Connect first.</p>}
    </>
  );
}
