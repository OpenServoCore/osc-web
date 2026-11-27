import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { headline, reasons, type DataState } from "@/lib/data-state";

/** What the servo booted on and what the belt refused; nothing while both are clear. */
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
      {list.length > 0 && (
        <AlertDescription className="text-warning">
          <span className="font-mono text-xs opacity-70">
            data_flags 0x{state.flags.toString(16).padStart(2, "0")}:{" "}
            {list.map((r) => r.name).join(" | ")}
          </span>
        </AlertDescription>
      )}
    </Alert>
  );
}
