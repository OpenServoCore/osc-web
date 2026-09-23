import type { Descriptor } from "@openservocore/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, CircleHelp, Cog, Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ValueEditor } from "@/components/value-editor";
import { toValue, type EditValue } from "@/lib/edit";
import { hexAddr } from "@/lib/format";
import { useSession } from "@/lib/session";
import {
  buildTable,
  formatRow,
  type Group,
  type Link as LinkTarget,
  type Row,
  type Tab,
  type TabName,
} from "@/lib/table-model";
import { FLASH_MS, LIVE_POLL_MS, spanHolding, startPoll } from "@/lib/table-live";
import { decodeSpan, readRows, readSpans, type Values } from "@/lib/table-read";

export const Route = createFileRoute("/table")({ component: TablePage });

const HELP: ReadonlyMap<string, string> = new Map([
  [
    "Control loops",
    "Gains of the current, velocity and position loops and the observer behind them.",
  ],
  ["Safety", "Trip thresholds and what the servo does when one is crossed."],
  ["Thermal", "The winding temperature model and its cutoff."],
  ["Motor model", "Electrical and mechanical constants of the motor the estimators rely on."],
  ["Profile/capture", "Read profiles and the telemetry burst window."],
]);

const linkClass = "text-sm text-accent underline-offset-4 hover:underline";

function TablePage() {
  const { status, selected, descriptor, descriptorError } = useSession();
  const picked = status === "ready" && selected !== undefined;
  return (
    <>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Control table</h1>
        {picked && (
          <Link
            to="/servo"
            search={true}
            className="flex items-center gap-1 text-text-3 underline-offset-4 hover:underline"
          >
            <Cog className="size-4" />
            ID {selected}
          </Link>
        )}
      </div>
      {!picked ? (
        <p>Pick a servo in the sidebar.</p>
      ) : descriptorError !== undefined ? (
        <p className="text-danger">{descriptorError}</p>
      ) : descriptor === undefined ? (
        <Skeleton className="h-9 w-80" />
      ) : (
        <Table id={selected} descriptor={descriptor} />
      )}
    </>
  );
}

function Table({ id, descriptor }: { id: number; descriptor: Descriptor }) {
  const model = useMemo(() => buildTable(descriptor), [descriptor]);
  const [tab, setTab] = useState<TabName>("Settings");
  const [refresh, setRefresh] = useState(0);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as TabName);
      }}
    >
      <div className="flex items-center justify-between">
        <TabsList>
          {model.tabs.map((t) => (
            <TabsTrigger key={t.name} value={t.name}>
              {t.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {tab !== "Live values" && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setRefresh((n) => n + 1);
            }}
          >
            <RefreshCw />
            Refresh
          </Button>
        )}
      </div>
      {model.tabs.map((t) => (
        <TabsContent key={t.name} value={t.name}>
          <TabPanel key={id} id={id} descriptor={descriptor} tab={t} refresh={refresh} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

interface Flash {
  name: string;
  seq: number;
}

function TabPanel({
  id,
  descriptor,
  tab,
  refresh,
}: {
  id: number;
  descriptor: Descriptor;
  tab: Tab;
  refresh: number;
}) {
  const { run } = useSession();
  const [values, setValues] = useState<Values>();
  const [error, setError] = useState<string>();
  const [flash, setFlash] = useState<Flash>();
  const holds = useRef(0);
  const rows = useMemo(() => tab.groups.flatMap((g) => g.rows), [tab]);
  const spans = useMemo(() => readSpans(rows), [rows]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const v = await run((c) =>
        readRows(rows, descriptor, (addr, count) => c.read(id, addr, count)),
      );
      if (!live) return;
      setValues(v);
      setError(undefined);
    };
    const fail = (e: unknown) => {
      if (live) setError(e instanceof Error ? e.message : String(e));
    };
    const stop =
      tab.name === "Live values"
        ? startPoll({
            periodMs: LIVE_POLL_MS,
            tick: load,
            hold: () => holds.current > 0,
            onError: fail,
          })
        : (load().catch(fail), undefined);
    return () => {
      live = false;
      stop?.();
    };
  }, [run, id, descriptor, tab, rows, refresh]);

  useEffect(() => {
    if (flash === undefined) return;
    const timer = setTimeout(() => {
      setFlash(undefined);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flash]);

  async function apply(row: Row, raw: EditValue): Promise<void> {
    const { field } = row;
    const bytes = descriptor.encode(field.name, toValue(field, raw));
    const span = spanHolding(spans, field);
    holds.current++;
    try {
      const fresh = await run(async (c) => {
        await c.write(id, field.addr, bytes);
        return decodeSpan(descriptor, rows, span, await c.read(id, span.addr, span.count));
      });
      setValues((v) => new Map([...(v ?? []), ...fresh]));
      setFlash((f) => ({ name: field.name, seq: (f?.seq ?? 0) + 1 }));
    } finally {
      holds.current--;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== undefined && <p className="text-danger">{error}</p>}
      {tab.groups.map((group) => (
        <GroupSection
          key={group.label}
          group={group}
          values={values}
          loading={values === undefined && error === undefined}
          flashed={flash?.name}
          onApply={apply}
        />
      ))}
    </div>
  );
}

function GroupSection({
  group,
  values,
  loading,
  flashed,
  onApply,
}: {
  group: Group;
  values: Values | undefined;
  loading: boolean;
  flashed: string | undefined;
  onApply: (row: Row, raw: EditValue) => Promise<void>;
}) {
  return (
    <Collapsible defaultOpen={group.expanded} className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left font-medium [&[data-state=open]>svg]:rotate-90">
          <ChevronRight className="size-4 shrink-0 transition-transform" />
          {group.label}
          <span className="font-normal text-text-3">{group.rows.length}</span>
        </CollapsibleTrigger>
        {group.help && <HelpMark label={group.label} />}
      </div>
      <CollapsibleContent>
        <table className="w-full border-t text-sm">
          <tbody>
            {group.rows.map((row) => (
              <RowLine
                key={row.field.name}
                row={row}
                value={values?.get(row.field.name)}
                loading={loading}
                flashed={row.field.name === flashed}
                onApply={onApply}
              />
            ))}
          </tbody>
        </table>
      </CollapsibleContent>
    </Collapsible>
  );
}

function HelpMark({ label }: { label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`About ${label}`}>
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" className="w-64">
        {HELP.get(label)}
      </PopoverContent>
    </Popover>
  );
}

function RowLine({
  row,
  value,
  loading,
  flashed,
  onApply,
}: {
  row: Row;
  value: EditValue | undefined;
  loading: boolean;
  flashed: boolean;
  onApply: (row: Row, raw: EditValue) => Promise<void>;
}) {
  return (
    <tr
      className={`border-t first:border-t-0 ${flashed ? "bg-success-soft" : "transition-colors duration-700"}`}
    >
      <th scope="row" className="w-1/2 px-3 py-2 text-left align-top font-medium">
        <div>{row.label}</div>
        <div className="font-mono text-xs font-normal text-text-3">
          <span>{row.field.name}</span> <span>{hexAddr(row.field.addr)}</span>
        </div>
      </th>
      <td className="px-3 py-2 align-top font-mono tabular-nums">
        {value !== undefined ? (
          <ValueCell row={row} value={value} onApply={onApply} />
        ) : loading ? (
          <Skeleton className="h-4 w-16" />
        ) : (
          "-"
        )}
      </td>
    </tr>
  );
}

function ValueCell({
  row,
  value,
  onApply,
}: {
  row: Row;
  value: EditValue;
  onApply: (row: Row, raw: EditValue) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        {row.editable && !row.blob ? (
          <ValueEditor field={row.field} value={value} onApply={(raw) => onApply(row, raw)} />
        ) : (
          formatRow(row, value)
        )}
        {row.hint !== undefined && (
          <>
            {" "}
            <span className="font-sans text-text-3">{row.hint}</span>
          </>
        )}
      </span>
      {row.link !== undefined && (
        <>
          {" "}
          <RowLink target={row.link} />
        </>
      )}
      {row.blob && value instanceof Uint8Array && (
        <>
          {" "}
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              download(`${row.field.name}.bin`, value);
            }}
          >
            <Download />
            Download
          </Button>
        </>
      )}
    </div>
  );
}

function RowLink({ target }: { target: LinkTarget }) {
  return target === "connection" ? (
    <Link to="/" search={true} className={linkClass}>
      Change in Connection
    </Link>
  ) : (
    <Link to="/servo" search={true} className={linkClass}>
      Change on Servo page
    </Link>
  );
}

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
