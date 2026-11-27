import type { TuningPolicy } from "@openservocore/client";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, SlidersHorizontal, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { InputEditor } from "@/components/input-editor";
import { PolicyCard } from "@/components/policy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { policies, profiles } from "@/lib/library";
import { copyKey, DEFAULT_KEY, DEFAULT_POLICY, importPolicy, portability } from "@/lib/policy-form";
import { parseNumber } from "@/lib/profile-form";
import { download, useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/policies")({ component: PoliciesPage });

interface Note {
  text: string;
  error: boolean;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function PoliciesPage() {
  const library = useLibrary(policies);
  const shelf = useLibrary(profiles);
  const [chosen, setChosen] = useState(DEFAULT_KEY);
  const [profileKey, setProfileKey] = useState<string>();
  const [ohms, setOhms] = useState("");
  const [note, setNote] = useState<Note>();
  const rId = useId();

  const own = library.entries;
  const entry = own?.find((e) => e.value.key === chosen);
  const policy: TuningPolicy = entry?.value ?? DEFAULT_POLICY;
  const builtIn = entry === undefined;
  const profile = (shelf.entries?.find((e) => e.value.key === profileKey) ?? shelf.entries?.[0])
    ?.value;
  const r = parseNumber(ohms);
  const rOhm = "value" in r && r.value !== null && r.value > 0 ? r.value : undefined;
  const keys = new Set([DEFAULT_KEY, ...(own?.map((e) => e.value.key) ?? [])]);

  async function copy(name: string) {
    const key = copyKey(name);
    const saved = await library.save({ ...policy, key, label: name, revision: undefined });
    setChosen(saved.value.key);
    setNote(undefined);
  }

  async function importFile(file: File) {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch (e) {
        throw new Error(`${file.name} is not JSON`, { cause: e });
      }
      const m = importPolicy(parsed, file.name);
      if (m.policy.key === DEFAULT_KEY)
        throw new Error("the key default is the built-in Default's");
      const replaced = keys.has(m.policy.key);
      const saved = await library.save(m.policy);
      setChosen(saved.value.key);
      const what = replaced
        ? `Replaced ${saved.value.key} with ${file.name}, now revision ${saved.value.revision}.`
        : `Imported ${saved.value.key} from ${file.name}.`;
      setNote({ text: [what, ...m.notes].join(" "), error: false });
    } catch (e) {
      setNote({ text: `${file.name} was not imported: ${message(e)}`, error: true });
    }
  }

  async function exportPolicy(key: string) {
    const bytes = await library.exportBytes(key);
    if (bytes !== null) download(bytes, `${key}.json`);
  }

  const head = (
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor={`${rId}-profile`} className="text-sm font-normal">
        Preview with profile
      </Label>
      {shelf.entries !== undefined && shelf.entries.length > 0 && profile !== undefined ? (
        <Select value={profile.key} onValueChange={setProfileKey}>
          <SelectTrigger id={`${rId}-profile`} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shelf.entries.map((e) => (
              <SelectItem key={e.value.key} value={e.value.key}>
                {e.value.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span id={`${rId}-profile`} className="text-sm text-text-3">
          no profile in the library yet
        </span>
      )}
      <Label htmlFor={`${rId}-r`} className="ml-2 text-sm font-normal">
        at a winding of
      </Label>
      <Input
        id={`${rId}-r`}
        aria-label="Preview resistance"
        inputMode="decimal"
        autoComplete="off"
        className="w-20 font-mono"
        placeholder="R"
        value={ohms}
        onChange={(e) => {
          setOhms(e.target.value);
        }}
      />
      <span className="text-sm text-text-3">ohm</span>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <SlidersHorizontal className="size-5" />
          Tuning policies
        </h1>
        <div className="ml-auto flex gap-2">
          <ImportButton onFile={(f) => void importFile(f)} />
          <InputEditor
            title="Copy to edit"
            current={`a copy of ${policy.key}`}
            fields={[{ id: "name", label: "Name", text: true, placeholder: "Arm joints" }]}
            initial={() => ({})}
            check={(v) => {
              const key = copyKey(v.name ?? "");
              if (key === "") return { error: "Name the copy: its key is built from the name" };
              if (keys.has(key)) return { error: `The library already holds ${key}` };
              return { preview: `= policies/${key}.json` };
            }}
            onSave={(v) => copy((v.name ?? "").trim())}
            saveLabel="Copy"
          >
            <Button>
              <Copy />
              Copy to edit
            </Button>
          </InputEditor>
        </div>
      </div>
      {note !== undefined && (
        <p role="status" className={note.error ? "mb-3 text-danger" : "mb-3 text-sm text-text-3"}>
          {note.text}
        </p>
      )}
      {library.error !== undefined && <p className="mb-3 text-danger">{library.error}</p>}
      {own === undefined || shelf.entries === undefined ? (
        library.error === undefined && <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid grid-cols-[18rem_1fr] items-start gap-4">
          <nav aria-label="Policies" className="flex flex-col gap-2">
            {[DEFAULT_POLICY, ...own.map((e) => e.value)].map((p) => (
              <button
                key={p.key}
                type="button"
                aria-current={p.key === policy.key}
                className="flex items-center gap-2 rounded-lg border bg-card p-3 text-left hover:bg-muted aria-[current=true]:border-primary"
                onClick={() => {
                  setChosen(p.key);
                  setNote(undefined);
                }}
              >
                <span className="truncate font-mono text-sm">{p.key}</span>
                <Badge variant="outline" className="ml-auto">
                  {p.key === DEFAULT_KEY ? "built in" : portability(p)}
                </Badge>
              </button>
            ))}
          </nav>
          <PolicyCard
            key={policy.key}
            policy={policy}
            builtIn={builtIn}
            profile={profile}
            rOhm={rOhm}
            head={head}
            onSave={library.save}
            onExport={builtIn ? undefined : () => void exportPolicy(policy.key)}
          />
        </div>
      )}
    </>
  );
}

function ImportButton({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Policy file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file !== undefined) onFile(file);
        }}
      />
      <Button variant="outline" onClick={() => input.current?.click()}>
        <Upload />
        Import
      </Button>
    </>
  );
}
