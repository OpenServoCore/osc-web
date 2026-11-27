import { migrate, type ServoProfile } from "@openservocore/client";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { InputEditor } from "@/components/input-editor";
import { ProfileCard, ProfileStatus } from "@/components/profile-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { profiles, sha1, type Stored } from "@/lib/library";
import { usedBy } from "@/lib/ident-setup";
import { blankProfile, GEAR_TEXT, identifiable, profileKey } from "@/lib/profile-form";
import { useSession } from "@/lib/session";
import { download, useLibrary } from "@/lib/use-library";
import { loadWasm } from "@/lib/wasm";
import { useSetups } from "@/lib/use-setup";

export const Route = createFileRoute("/profiles")({
  component: ProfilesPage,
  // The rest of the query (`?sim`) passes through untouched.
  validateSearch: (search: Record<string, unknown>): { profile?: string } => ({
    ...search,
    profile: typeof search.profile === "string" ? search.profile : undefined,
  }),
});

interface Note {
  text: string;
  error: boolean;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** osc-ident reads the heat model beside a version 0 nameplate from this file name. */
const THERMAL_JSON = "thermal.json";

async function readJson(file: File): Promise<{ parsed: unknown; bytes: Uint8Array<ArrayBuffer> }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { parsed: JSON.parse(new TextDecoder().decode(bytes)), bytes };
  } catch (e) {
    throw new Error(`${file.name} is not JSON`, { cause: e });
  }
}

function ProfilesPage() {
  const library = useLibrary(profiles);
  const { setups, error: setupsError } = useSetups();
  const { servos } = useSession();
  const [chosen, setChosen] = useState(Route.useSearch().profile);
  const [note, setNote] = useState<Note>();
  const entries = library.entries;
  const selected = entries?.find((e) => e.value.key === chosen) ?? entries?.[0];
  const keys = new Set(entries?.map((e) => e.value.key));

  async function create(maker: string, name: string, variant: string) {
    const saved = await library.save(blankProfile({ maker, name, variant }));
    setChosen(saved.value.key);
    setNote(undefined);
  }

  async function importFiles(files: readonly File[]) {
    const names = files.map((f) => f.name).join(" and ");
    try {
      // The file input is live before the library's first read has loaded the checks.
      await loadWasm();
      const thermal = files.find((f) => f.name === THERMAL_JSON);
      const [file, ...more] = files.filter((f) => f !== thermal);
      if (file === undefined) {
        throw new Error(
          `${THERMAL_JSON} is the heat model beside a version 0 nameplate: import the nameplate with it`,
        );
      }
      if (more.length > 0) {
        throw new Error(
          `import one profile file at a time, with the ${THERMAL_JSON} beside a version 0 nameplate`,
        );
      }
      const profile = await readJson(file);
      const heat = thermal === undefined ? undefined : await readJson(thermal);
      const m =
        heat === undefined
          ? migrate(profile.parsed, undefined)
          : migrate(
              profile.parsed,
              undefined,
              undefined,
              heat.parsed,
              THERMAL_JSON,
              await sha1(heat.bytes),
            );
      const replaced = keys.has(m.profile.key);
      const saved = await library.save(m.profile);
      setChosen(saved.value.key);
      const what = replaced
        ? `Replaced ${saved.value.key} with ${names}, now revision ${saved.value.revision}.`
        : `Imported ${saved.value.key} from ${names}.`;
      setNote({ text: [what, ...m.notes].join(" "), error: false });
    } catch (e) {
      const were = files.length > 1 ? "were" : "was";
      setNote({ text: `${names} ${were} not imported: ${message(e)}`, error: true });
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
          <ImportButton onFiles={(f) => void importFiles(f)} />
          <NewProfile keys={keys} onCreate={create} />
        </div>
      </div>
      {note !== undefined && (
        <p role="status" className={note.error ? "mb-3 text-danger" : "mb-3 text-sm text-text-3"}>
          {note.text}
        </p>
      )}
      {library.error !== undefined && <p className="mb-3 text-danger">{library.error}</p>}
      {setupsError !== undefined && <p className="mb-3 text-danger">{setupsError}</p>}
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
            usedBy={(key) =>
              setups === undefined
                ? undefined
                : usedBy(key, setups, (uid) => servos.find((s) => s.uid === uid)?.id)
            }
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
  usedBy,
  selected,
  onSelect,
}: {
  entries: readonly Stored<ServoProfile>[];
  usedBy: (key: string) => string | undefined;
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
            {[
              p.gear_class == null ? "gears not set" : GEAR_TEXT[p.gear_class].toLowerCase(),
              p.gear_class != null && !identifiable(p) ? "cannot identify" : undefined,
              usedBy(p.key),
            ]
              .filter((part) => part !== undefined)
              .join(" . ")}
          </span>
        </button>
      ))}
    </nav>
  );
}

function ImportButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        multiple
        className="hidden"
        aria-label="Profile file"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
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
