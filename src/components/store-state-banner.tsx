import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { defaults, warnings, type StoreState } from "@/lib/store-state";

const hex = (v: number) => `0x${v.toString(16).padStart(2, "0")}`;

/** One warning per stored-state case; nothing while all are clear. */
export function StoreStateBanner({ state }: { state: StoreState }) {
  const list = warnings(state);
  if (list.length === 0) return null;
  const images = defaults(state.status);
  return (
    <Alert
      role="status"
      aria-label="Stored state"
      className="mb-4 border-warning bg-warning-soft text-warning"
    >
      <ShieldAlert />
      <AlertTitle>
        {list.map((w) => (
          <p key={w.kind}>{w.text}</p>
        ))}
      </AlertTitle>
      <AlertDescription className="text-warning">
        <span className="font-mono text-xs opacity-70">
          status_flags {hex(state.status)}
          {images.length > 0 && `: ${images.join(" | ")}`}, refused_modes {hex(state.refused)}
        </span>
      </AlertDescription>
    </Alert>
  );
}
