import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "../lib/session";

export const Route = createFileRoute("/table")({ component: TablePage });

function TablePage() {
  const { status } = useSession();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Control Table</h1>
      {status !== "ready" && <p>Connect first.</p>}
    </>
  );
}
