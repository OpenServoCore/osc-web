import { LoaderCircle, Pencil } from "lucide-react";
import {
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface EditorField {
  id: string;
  label: string;
  unit?: string;
  /** A select over these; otherwise a text box. */
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  text?: boolean;
}

export type Values = Readonly<Record<string, string>>;

/** `error` keeps Save disabled; `warning` names an outcome and never blocks. */
export interface Verdict {
  preview?: string;
  error?: string;
  warning?: string;
}

interface InputEditorProps {
  title: string;
  current?: string;
  fields: readonly EditorField[];
  initial: () => Values;
  check: (values: Values) => Verdict;
  onSave: (values: Values) => Promise<void>;
  /** Above the controls, such as a Share / Fixed segment. */
  head?: (values: Values, set: (next: Values) => void) => ReactNode;
  saveLabel?: string;
  children: ReactElement;
}

/** A value that opens its editor: mono, a pencil on hover. */
export function ValueButton({ className, children, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "group/value inline-flex items-center gap-1 rounded-sm px-1 font-mono tabular-nums hover:bg-muted data-open:bg-muted",
        className,
      )}
      {...props}
    >
      {children}
      <Pencil className="size-3 opacity-0 group-hover/value:opacity-60" />
    </button>
  );
}

/** The app's one anchored editor for a host-side value: Save writes at once. */
export function InputEditor({
  title,
  current,
  fields,
  initial,
  check,
  onSave,
  head,
  saveLabel = "Save",
  children,
}: InputEditorProps) {
  const base = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  const verdict = open ? check(values) : {};
  const message = verdict.error ?? failure ?? verdict.warning;
  const tone = verdict.error !== undefined || failure !== undefined ? "error" : "warning";

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setValues(initial());
      setFailure(undefined);
    }
  }

  function set(next: Values) {
    setValues(next);
    setFailure(undefined);
  }

  async function save() {
    if (verdict.error !== undefined || pending) return;
    setPending(true);
    try {
      await onSave(values);
      setOpen(false);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  // A select's own Enter runs first and prevents default; its listbox is portaled.
  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    e.preventDefault();
    void save();
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-88 gap-2"
        aria-label={title}
        onKeyDown={keyDown}
      >
        <span className="font-medium">{title}</span>
        {current !== undefined && <span className="text-xs text-text-3">Current: {current}</span>}
        {head?.(values, set)}
        {fields.map((f) => (
          <div key={f.id} className="flex flex-col gap-1">
            <Label htmlFor={`${base}-${f.id}`} className="text-xs font-normal text-text-3">
              {f.label}
            </Label>
            <div className="flex items-center gap-2">
              <Control
                field={f}
                id={`${base}-${f.id}`}
                value={values[f.id] ?? ""}
                invalid={verdict.error !== undefined}
                onChange={(v) => {
                  set({ ...values, [f.id]: v });
                }}
              />
              {f.unit !== undefined && (
                <span className="shrink-0 text-sm whitespace-nowrap text-text-3">{f.unit}</span>
              )}
            </div>
          </div>
        ))}
        <p className="min-h-[1.125rem] text-xs text-text-3">{verdict.preview}</p>
        <p
          role={message === undefined ? undefined : "status"}
          className={cn(
            "min-h-[1.125rem] text-xs",
            tone === "error" ? "text-destructive" : "text-warning",
          )}
        >
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={verdict.error !== undefined || pending}
            onClick={() => void save()}
          >
            {pending && <LoaderCircle className="animate-spin" />}
            {saveLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const UNSET = "-";

function Control({
  field,
  id,
  value,
  invalid,
  onChange,
}: {
  field: EditorField;
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  if (field.options !== undefined) {
    // A Radix select item cannot carry the empty value, so "not set" travels as a dash.
    return (
      <Select
        value={value === "" ? UNSET : value}
        onValueChange={(v) => {
          onChange(v === UNSET ? "" : v);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (
            <SelectItem key={o.value} value={o.value === "" ? UNSET : o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      id={id}
      inputMode={field.text === true ? "text" : "decimal"}
      autoComplete="off"
      spellCheck={false}
      className={field.text === true ? undefined : "font-mono"}
      placeholder={field.placeholder}
      value={value}
      aria-invalid={invalid}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}
