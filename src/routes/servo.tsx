import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "../lib/session";

export const Route = createFileRoute("/servo")({ component: ServoPage });

function ServoPage() {
  const { client } = useSession();
  return (
    <>
      <h1>Servo</h1>
      {client === undefined && <p>Connect first.</p>}
    </>
  );
}
