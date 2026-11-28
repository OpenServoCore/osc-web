import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBaud } from "@/lib/format";
import type { RunIdentity } from "@/lib/run-folder";
import { saveRefusal, saveSaid } from "@/lib/save-set";
import { useSession } from "@/lib/session";
import { useSaveSet } from "@/lib/use-save-set";

/**
 * "Save this set": the run's final set and table, from its folder, installed, saved, read back
 * after a restart and checked against the folder, as `osc-ident save` then `osc-ident check` do.
 * `servo` is the servo the save would go to: the one on the run's id, or the run's servo by uid.
 */
export function SaveSet({
  identity,
  servo,
}: {
  identity: RunIdentity;
  servo: { id: number; uid: string } | undefined;
}) {
  const { baud, simulated, status, discover } = useSession();
  const { view, save } = useSaveSet(simulated, () => {
    void discover();
  });
  const live = status === "ready" || status === "scanning";
  const refusal = saveRefusal(identity, live ? servo : undefined);
  const at = `${identity.uid}/${identity.utc}`;
  const said = view.outcome === undefined ? undefined : saveSaid(view.outcome);
  const backup = view.outcome?.files[0]?.path.split("/").slice(0, 2).join("/");
  const rate = baud === undefined ? "the bus speed it runs at now" : formatBaud(baud);
  return (
    <section aria-label="Save this set" className="flex flex-col gap-2 text-sm">
      <p className="text-text-2">
        Installs the run's final set and table from its folder, so it works after a restart too,
        saves them on the servo, restarts it and checks it against the folder. The servo's stored
        settings are backed up in this browser first.
      </p>
      <p className="text-text-2">
        The save also stores the bus speed the servo runs at now, {rate}: it starts at {rate} from
        then on. A speed changed on this page holds only until a restart unless it is saved, as Save
        settings on the servo page does too.
      </p>
      {refusal !== undefined && (
        <p role="status" className="text-warning">
          {refusal}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={refusal !== undefined || view.phase === "saving" || servo === undefined}
          onClick={() => {
            if (servo !== undefined) void save(servo.id, at, baud);
          }}
        >
          {view.phase === "saving" ? <LoaderCircle className="animate-spin" /> : <Save />}
          Save this set
        </Button>
        {view.phase === "saving" && (
          <span className="text-text-3">
            Saving: the servo restarts twice. Leave the bus alone.
          </span>
        )}
      </div>
      {view.failure !== undefined && <p className="text-danger">{view.failure}</p>}
      {said !== undefined && (
        <p role="status" aria-label="Save result" className={said.bad ? "text-warning" : ""}>
          {said.text}
          {view.outcome?.saved === true &&
            view.outcome.bootsAt !== undefined &&
            ` It starts at ${formatBaud(view.outcome.bootsAt)}.`}
          {backup !== undefined && ` The backup is in this browser at ${backup}/.`}
        </p>
      )}
      {view.outcome?.differences !== undefined && view.outcome.differences.length > 0 && (
        <ul aria-label="Differences" className="list-disc pl-5 font-mono text-xs">
          {view.outcome.differences.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {view.outcome !== undefined && view.outcome.lines.length > 0 && (
        <details>
          <summary className="cursor-pointer text-text-3">The tool's lines</summary>
          <pre
            aria-label="Save lines"
            className="mt-1 max-h-64 overflow-auto rounded border bg-card p-2 font-mono text-xs whitespace-pre-wrap"
          >
            {view.outcome.lines.join("\n")}
          </pre>
        </details>
      )}
    </section>
  );
}
