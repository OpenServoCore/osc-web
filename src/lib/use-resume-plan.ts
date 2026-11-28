import type { ResumeArgs, ResumePlan } from "@openservocore/client-ident";
import { useEffect, useState } from "react";
import { openIdentWorker } from "./ident-worker";

export interface ResumeCheck {
  /** Undefined while the module loads and decides. */
  plan: ResumePlan | undefined;
  /** Why the module would refuse the resume, in its words. */
  refused: string | undefined;
}

/**
 * What a resume of `args.folder` would do, as the module decides it from the folder's files alone,
 * nothing sent: a worker of its own, closed once it answered. Undefined args decide nothing.
 */
export function useResumePlan(args: ResumeArgs | undefined): ResumeCheck {
  const [check, setCheck] = useState<ResumeCheck & { of?: ResumeArgs }>({
    plan: undefined,
    refused: undefined,
  });
  useEffect(() => {
    if (args === undefined) return;
    let live = true;
    void (async () => {
      try {
        const worker = await openIdentWorker();
        try {
          const plan = await worker.planResume(args);
          if (live) setCheck({ of: args, plan, refused: undefined });
        } finally {
          worker.close();
        }
      } catch (e) {
        const refused = e instanceof Error ? e.message : String(e);
        if (live) setCheck({ of: args, plan: undefined, refused });
      }
    })();
    return () => {
      live = false;
    };
  }, [args]);
  return check.of === args && args !== undefined
    ? { plan: check.plan, refused: check.refused }
    : { plan: undefined, refused: undefined };
}
