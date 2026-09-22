import { useSyncExternalStore } from "react";

let open: boolean | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Undefined until something opens or closes it, so the sidebar's boot default applies. */
export function useConnectionPopover(): [boolean | undefined, (open: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => open,
    () => undefined,
  );
  const set = (next: boolean) => {
    open = next;
    for (const listener of listeners) listener();
  };
  return [value, set];
}
