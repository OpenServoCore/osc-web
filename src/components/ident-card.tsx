import type { ServoProfile, TuningPolicy } from "@openservocore/client";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, CircleQuestionMark, Copy, ScanSearch } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FIELD_NAME, isServoCopy, readiness, servoCopyKey, type Blocker } from "@/lib/ident-setup";
import { policies, profiles, refOf, type ServoSetup, type Stored } from "@/lib/library";
import { DEFAULT_KEY, DEFAULT_POLICY } from "@/lib/policy-form";
import { useLibrary } from "@/lib/use-library";
import { useSetup } from "@/lib/use-setup";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function IdentCard({ id, uid }: { id: number; uid: string }) {
  const profileShelf = useLibrary(profiles);
  const policyShelf = useLibrary(policies);
  const { setup, error, choose } = useSetup(uid);
  const [failure, setFailure] = useState<string>();
  const navigate = useNavigate();
  const rId = useId();

  const problem = failure ?? error ?? profileShelf.error ?? policyShelf.error;
  const loaded =
    setup !== undefined && profileShelf.entries !== undefined && policyShelf.entries !== undefined;

  async function save(next: ServoSetup) {
    try {
      await choose(next);
      setFailure(undefined);
    } catch (e) {
      setFailure(message(e));
    }
  }

  return (
    <Card role="region" aria-label="Identification" className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanSearch className="size-4" />
          Identification
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="About identification">
                <CircleQuestionMark />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start">
              An identification measures this servo and writes its constants. It reads the facts
              about the model from the profile and every choice from the tuning policy. The choice
              is kept in this browser for this servo.
            </PopoverContent>
          </Popover>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {problem !== undefined && <p className="text-danger">{problem}</p>}
        {!loaded || setup === undefined ? (
          problem === undefined && <Skeleton className="h-24 w-full" />
        ) : (
          <Chooser
            uid={uid}
            rId={rId}
            setup={setup}
            profiles={profileShelf.entries ?? []}
            policies={policyShelf.entries ?? []}
            onChoose={save}
            onCopy={async (policy) => {
              const key = servoCopyKey(policy.key, uid);
              try {
                // A copy made earlier keeps its edits: it is chosen again, never overwritten.
                const saved =
                  policyShelf.entries?.find((e) => e.value.key === key) ??
                  (await policyShelf.save({
                    ...policy,
                    key,
                    label: `${policy.label ?? policy.key} for ID ${id}`,
                    revision: undefined,
                  }));
                await save({ ...setup, policy: refOf(saved) });
              } catch (e) {
                setFailure(message(e));
              }
            }}
            onIdentify={() => {
              void navigate({ to: "/identify", search: true });
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Chooser({
  uid,
  rId,
  setup,
  profiles,
  policies,
  onChoose,
  onCopy,
  onIdentify,
}: {
  uid: string;
  rId: string;
  setup: ServoSetup;
  profiles: readonly Stored<ServoProfile>[];
  policies: readonly Stored<TuningPolicy>[];
  onChoose: (next: ServoSetup) => Promise<void>;
  onCopy: (policy: TuningPolicy) => Promise<void>;
  onIdentify: () => void;
}) {
  const profile = profiles.find((e) => e.value.key === setup.profile?.key);
  const ownPolicy = policies.find((e) => e.value.key === setup.policy?.key);
  const policy = ownPolicy?.value ?? DEFAULT_POLICY;
  const ready = readiness(profile?.value, policy);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor={`${rId}-profile`} className="text-sm font-normal">
          Profile
        </Label>
        <Select
          value={profile?.value.key ?? ""}
          onValueChange={(key) => {
            const entry = profiles.find((e) => e.value.key === key);
            if (entry !== undefined) void onChoose({ ...setup, profile: refOf(entry) });
          }}
        >
          <SelectTrigger id={`${rId}-profile`} className="w-56">
            <SelectValue placeholder="Choose a profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((e) => (
              <SelectItem key={e.value.key} value={e.value.key}>
                {e.value.key} rev {e.value.revision}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link to="/profiles" search={true}>
            New profile
          </Link>
        </Button>
        <Label htmlFor={`${rId}-policy`} className="ml-4 text-sm font-normal">
          Policy
        </Label>
        <Select
          value={ownPolicy?.value.key ?? DEFAULT_KEY}
          onValueChange={(key) => {
            const entry = policies.find((e) => e.value.key === key);
            void onChoose({ ...setup, policy: entry === undefined ? null : refOf(entry) });
          }}
        >
          <SelectTrigger id={`${rId}-policy`} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_KEY}>Default</SelectItem>
            {policies.map((e) => (
              <SelectItem key={e.value.key} value={e.value.key}>
                {e.value.key} rev {e.value.revision}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isServoCopy(policy.key, uid) && (
          <Button variant="outline" size="sm" onClick={() => void onCopy(policy)}>
            <Copy />
            Copy for this servo
          </Button>
        )}
      </div>
      <BlockerLine blocker={ready.blocker} profileKey={profile?.value.key} policyKey={policy.key} />
      {ready.warning !== undefined && (
        <p className="flex items-start gap-2 text-sm text-warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {ready.warning}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={ready.blocker !== undefined} onClick={onIdentify}>
          Identify
        </Button>
        <span className="text-sm text-text-3">
          {ready.blocker === undefined ? "The horn moves stop to stop." : undefined}
        </span>
      </div>
    </>
  );
}

function BlockerLine({
  blocker,
  profileKey,
  policyKey,
}: {
  blocker: Blocker | undefined;
  profileKey: string | undefined;
  policyKey: string;
}) {
  if (blocker === undefined) return null;
  const openProfile = (
    <Link to="/profiles" search={(s) => ({ ...s, profile: profileKey })} className="underline">
      open it
    </Link>
  );
  switch (blocker.kind) {
    case "no-profile":
      return (
        <p className="text-sm text-text-3">Choose the profile that describes this servo's model.</p>
      );
    case "not-metal":
      return (
        <p className="text-sm text-text-3">
          {blocker.text} {openProfile}
        </p>
      );
    case "missing":
      return (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p className="text-text-3">
            The profile has no {FIELD_NAME[blocker.field]}: {openProfile}
          </p>
          <p className="text-warning">{blocker.text}</p>
        </div>
      );
    case "refused":
      return (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p className="text-warning">{blocker.text}</p>
          {policyKey !== DEFAULT_KEY && (
            <Link
              to="/policies"
              search={(s) => ({ ...s, policy: policyKey })}
              className="text-text-3 underline"
            >
              Open {policyKey} on Tuning policies
            </Link>
          )}
        </div>
      );
  }
}
