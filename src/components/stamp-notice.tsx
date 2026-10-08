import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useBus } from "@/lib/bus/hooks";
import { useSession } from "@/lib/session";
import { saveAndStamp } from "@/lib/stamp";

/** Why closed loop went off after a covered edit, and the one way back the editor offers. */
export function StampNotice({ id, onStamped }: { id: number; onStamped: () => void }) {
  const bus = useBus();
  const { descriptor } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function stamp() {
    if (descriptor === undefined) return;
    setBusy(true);
    try {
      await bus.command((c) => saveAndStamp(c, id, descriptor));
      setError(undefined);
      onStamped();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert
      role="status"
      aria-label="Stamp"
      className="mb-4 border-warning bg-warning-soft text-warning"
    >
      <ShieldAlert />
      <AlertTitle>Closed loop is off: the stamp no longer matches.</AlertTitle>
      <AlertDescription className="text-warning">
        Save and stamp to re-enable it. Torque goes off, and the settings as they are now become the
        stamped set.
        {error !== undefined && <span className="text-danger">{error}</span>}
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void stamp()}>
          {busy && <LoaderCircle className="animate-spin" />}
          Save and stamp
        </Button>
      </AlertAction>
    </Alert>
  );
}
