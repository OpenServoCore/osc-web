import type { Field } from "@openservocore/client";
import { useState } from "react";
import { ValueEditor } from "./value-editor";
import type { EditValue } from "@/lib/edit";

// Copied from descriptors/osc-servo/0.1.json so the preview needs no session.
const PREVIEW: { field: Field; initial: EditValue }[] = [
  {
    field: {
      name: "id",
      addr: 16,
      width: 1,
      access: "rw",
      kind: "uint",
      min: 1,
      max: 249,
      variants: [],
    },
    initial: 1,
  },
  {
    field: {
      name: "mode",
      addr: 388,
      width: 1,
      access: "rw",
      kind: "enum",
      variants: [
        { name: "OpenLoop", value: 0 },
        { name: "Current", value: 1 },
        { name: "Velocity", value: 2 },
        { name: "Position", value: 3 },
      ],
    },
    initial: 3,
  },
  {
    field: { name: "torque_enable", addr: 384, width: 1, access: "rw", kind: "bool", variants: [] },
    initial: false,
  },
  {
    field: { name: "words", addr: 640, width: 8, access: "rw", kind: "bytes", variants: [] },
    initial: new Uint8Array([0x4f, 0x53, 0x43, 0x00, 0x01, 0x02, 0x03, 0x04]),
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function PreviewRow({ field, initial }: { field: Field; initial: EditValue }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <dt className="text-text-2">{field.name}</dt>
      <dd>
        <ValueEditor
          field={field}
          value={value}
          onApply={async (raw) => {
            await delay(300);
            setValue(raw);
          }}
        />
      </dd>
    </>
  );
}

export function EditorPreview() {
  return (
    <section>
      <h2 className="mb-2 text-md font-semibold">Editor preview</h2>
      <dl className="grid grid-cols-[max-content_auto] items-center gap-x-4 gap-y-1">
        {PREVIEW.map((p) => (
          <PreviewRow key={p.field.name} field={p.field} initial={p.initial} />
        ))}
      </dl>
    </section>
  );
}
