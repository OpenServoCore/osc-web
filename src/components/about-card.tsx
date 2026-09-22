import { unpackVersion, type Identity, type OscClient } from "@openservocore/client";
import { Cog } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queued } from "@/lib/command";
import { modelName } from "@/lib/descriptor";
import { formatVersion, hex16 } from "@/lib/format";

/** `capability_flags` bit order (protocol sec 5.4). */
const CAPABILITIES: readonly string[] = ["Motor encoder"];

function features(caps: number): string {
  const set: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if ((caps & (1 << bit)) === 0) continue;
    set.push(CAPABILITIES[bit] ?? `bit ${bit}`);
  }
  return set.length === 0 ? "None" : set.join(", ");
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="text-right break-all">{children}</span>
    </div>
  );
}

export function AboutCard({ client, id, uid }: { client: OscClient; id: number; uid: string }) {
  const [identity, setIdentity] = useState<Identity>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = await queued(() => client.identity(id));
        if (live) setIdentity(read);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [client, id]);

  const name = identity === undefined ? undefined : modelName(identity.model);
  return (
    <Card role="region" aria-label="About">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cog className="size-4" />
          About
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error !== undefined && <p className="text-danger">{error}</p>}
        {error === undefined && identity === undefined && (
          <>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </>
        )}
        {identity !== undefined && (
          <>
            <Row label="Model">
              {name === undefined ? (
                <span className="font-mono">{hex16(identity.model)}</span>
              ) : (
                <Tooltip>
                  <TooltipTrigger className="underline decoration-dotted underline-offset-4">
                    {name}
                  </TooltipTrigger>
                  <TooltipContent>{hex16(identity.model)}</TooltipContent>
                </Tooltip>
              )}
            </Row>
            <Row label="Firmware">
              <span className="font-mono">{formatVersion(unpackVersion(identity.fw))}</span>
            </Row>
            <Row label="Hardware">
              <span className="font-mono">{identity.hw}</span>
            </Row>
            <Row label="Serial">
              <span className="font-mono text-xs">{uid}</span>
            </Row>
            <Row label="Features">{features(identity.capabilities)}</Row>
          </>
        )}
      </CardContent>
    </Card>
  );
}
