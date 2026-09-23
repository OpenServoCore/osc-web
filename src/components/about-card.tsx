import { unpackVersion } from "@openservocore/client";
import { Cog } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReadOnce } from "@/lib/bus/hooks";
import { modelName } from "@/lib/descriptor";
import { formatVersion, hex16 } from "@/lib/format";
import { features, identityFrom, IDENTITY_REGISTERS } from "@/lib/identity";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="text-right break-all">{children}</span>
    </div>
  );
}

export function AboutCard({ id, uid }: { id: number; uid: string }) {
  const { snapshot, error } = useReadOnce(id, IDENTITY_REGISTERS);
  const identity = snapshot === undefined ? undefined : identityFrom(snapshot.read);

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
