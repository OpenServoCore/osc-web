import type { Stored } from "@openservocore/client-ident";
import { movePath, writeFile, type OpfsDir } from "./opfs";

/** The browser's copy of a run folder, kept as the run writes it. */
export interface Mirror {
  /** Applies one change; the run's worker hands them over one at a time, in order. */
  onStore: (change: Stored) => Promise<void>;
  /** The first change that could not be applied, in words, if one could not. */
  failure: () => string | undefined;
}

/**
 * Mirrors each change the run tells into `root` at its path from the store's root
 * (`<uid>/<UTC>/...`): a tab closed mid-run leaves the folder as far as the run got, `run.json`
 * behind the files it names, never ahead, for a resume to go on from. A change that fails is
 * kept, and the ones after it still go; the page writes the run's outcome over a mirror that
 * failed.
 */
export function mirrorInto(root: OpfsDir): Mirror {
  let failed: string | undefined;
  return {
    onStore: async (change) => {
      try {
        if (change.op === "write") {
          await writeFile(root, change.path, change.bytes as Uint8Array<ArrayBuffer>);
        } else {
          await movePath(root, change.from, change.to);
        }
      } catch (e) {
        const what = change.op === "write" ? change.path : `${change.from} to ${change.to}`;
        failed ??= `${what}: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    failure: () => failed,
  };
}
