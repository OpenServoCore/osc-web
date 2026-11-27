import { migrate, type ServoProfile } from "@openservocore/client";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { InputEditor } from "@/components/input-editor";
import { ProfileCard, ProfileStatus } from "@/components/profile-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { profiles, type Stored } from "@/lib/library";
import { blankProfile, GEAR_TEXT, identifiable, profileKey } from "@/lib/profile-form";
import { download, useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/profiles")({ component: ProfilesPage });

interface Note {
  text: string;
  error: boolean;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ProfilesPage() {
  const library = useLibrary(profiles);
  const [chosen, setChosen] = useState<string>();
  const [note, setNote] = useState<Note>();
  const entries = library.entries;
  const selected = entries?.find((e) => e.value.key === chosen) ?? entries?.[0];
  const keys = new Set(entries?.map((e) => e.value.key));

  async function create(maker: string, name: string, variant: string) {
    const saved = await library.save(blankProfile({ maker, name, variant }));
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
      const m = migrate(parsed, undefined);
      const replaced = keys.has(m.profile.key);
      const saved = await library.save(m.profile);
      setChosen(saved.value.key);
      const what = replaced
        ? `Replaced ${saved.value.key} with ${file.name}, now revision ${saved.value.revision}.`
        : `Imported ${saved.value.key} from ${file.name}.`;
      setNote({ text: [what, ...m.notes].join(" "), error: false });
    } catch (e) {
      setNote({ text: `${file.name} was not imported: ${message(e)}`, error: true });
    }
  }

  async function exportProfile(key: string) {
    const bytes = await library.exportBytes(key);
    if (bytes !== null) download(bytes, `${key}.json`);
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <BookOpen className="size-5" />
          Servo profiles
        </h1>
        <div className="ml-auto flex gap-2">
          <ImportButton onFile={(f) => void importFile(f)} />
          <NewProfile keys={keys} onCreate={create} />
        </div>
      </div>
      {note !== undefined && (
        <p role="status" className={note.error ? "mb-3 text-danger" : "mb-3 text-sm text-text-3"}>
          {note.text}
        </p>
      )}
      {library.error !== undefined && <p className="mb-3 text-danger">{library.error}</p>}
      {entries === undefined ? (
        library.error === undefined && <Skeleton className="h-64 w-full" />
      ) : selected === undefined ? (
        <p className="rounded-lg border border-dashed p-6 text-text-3">
          No profiles yet. Start one with New profile, or import a profile or nameplate file.
        </p>
      ) : (
        <div className="grid grid-cols-[18rem_1fr] items-start gap-4">
          <ProfileList
            entries={entries}
            selected={selected.value.key}
            onSelect={(key) => {
              setChosen(key);
              setNote(undefined);
            }}
          />
          <ProfileCard
            key={selected.value.key}
            entry={selected}
            onSave={library.save}
            onExport={() => void exportProfile(selected.value.key)}
          />
        </div>
      )}
    </>
  );
}

function ProfileList({
  entries,
  selected,
  onSelect,
}: {
  entries: readonly Stored<ServoProfile>[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Profiles" className="flex flex-col gap-2">
      {entries.map(({ value: p }) => (
        <button
          key={p.key}
          type="button"
          aria-current={p.key === selected}
          className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-left hover:bg-muted aria-[current=true]:border-primary"
          onClick={() => {
            onSelect(p.key);
          }}
        >
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-sm">{p.key}</span>
            <span className="ml-auto">
              <ProfileStatus profile={p} />
            </span>
          </span>
          <span className="text-xs text-text-3">
            {p.gear_class == null ? "gears not set" : GEAR_TEXT[p.gear_class].toLowerCase()}
            {p.gear_class != null && !identifiable(p) && " . cannot identify"}
          </span>
        </button>
      ))}
    </nav>
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
        aria-label="Profile file"
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

function NewProfile({
  keys,
  onCreate,
}: {
  keys: ReadonlySet<string>;
  onCreate: (maker: string, name: string, variant: string) => Promise<void>;
}) {
  const model = (v: Readonly<Record<string, string>>) => ({
    maker: (v.maker ?? "").trim(),
    name: (v.name ?? "").trim(),
    variant: (v.variant ?? "").trim(),
  });
  return (
    <InputEditor
      title="New profile"
      fields={[
        { id: "maker", label: "Maker", text: true, placeholder: "Vorpal" },
        { id: "name", label: "Model", text: true, placeholder: "MG90" },
        { id: "variant", label: "Variant (another gear set, another build)", text: true },
      ]}
      initial={() => ({})}
      check={(v) => {
        const m = model(v);
        if (m.maker === "" || m.name === "") {
          return { error: "Enter the maker and the model: the profile's key is built from them" };
        }
        const key = profileKey(m);
        if (key === "") return { error: "The names give no letters or digits for a key" };
        if (keys.has(key)) return { error: `The library already holds ${key}` };
        return { preview: `= profiles/${key}.json` };
      }}
      onSave={(v) => {
        const m = model(v);
        return onCreate(m.maker, m.name, m.variant);
      }}
      saveLabel="Create"
    >
      <Button>
        <Plus />
        New profile
      </Button>
    </InputEditor>
  );
}
