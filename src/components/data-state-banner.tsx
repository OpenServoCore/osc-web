import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { headline, reasons, type DataState } from "@/lib/data-state";

/** Why closed loop is off, most urgent reason first; nothing while the state is clean. */
export function DataStateBanner({ state }: { state: DataState }) {
  const title = headline(state);
  if (title === undefined) return null;
  const list = reasons(state.flags);
  return (
    <Alert
      role="status"
      aria-label="Data state"
      className="mb-4 border-warning bg-warning-soft text-warning"
    >
      <ShieldAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-warning">
        {list.length > 1 && (
          <ul className="list-disc pl-4">
            {list.slice(1).map((r) => (
              <li key={r.name}>{r.text}</li>
            ))}
          </ul>
        )}
        <span className="font-mono text-xs opacity-70">
          data_flags 0x{state.flags.toString(16).padStart(2, "0")}:{" "}
          {list.map((r) => r.name).join(" | ")}
        </span>
      </AlertDescription>
    </Alert>
  );
}
