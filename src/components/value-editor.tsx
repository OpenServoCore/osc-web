import type { Field } from "@openservocore/client";
import { LoaderCircle } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { hexAddr } from "@/lib/format";
import {
  editText,
  fieldKind,
  formatValue,
  parseInput,
  rangeHint,
  toRaw,
  type EditValue,
  type FieldKind,
  type NumberDisplay,
} from "@/lib/edit";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ValueEditorProps {
  field: Field;
  value: EditValue;
  onApply: (raw: EditValue) => Promise<void>;
  display?: NumberDisplay;
  /** The page's own rule over a parsed edit; its message keeps Apply disabled. */
  validate?: (raw: EditValue) => string | undefined;
  disabled?: string;
}

const valueClass = "rounded-sm px-1 font-mono tabular-nums";

function rawOf(kind: FieldKind, value: EditValue): EditValue {
  return kind.kind === "number" && typeof value === "number" ? toRaw(kind, value) : value;
}

export function ValueEditor({
  field,
  value,
  onApply,
  display,
  validate,
  disabled,
}: ValueEditorProps) {
  const base = fieldKind(field);
  const kind: FieldKind =
    base.kind === "number" && display !== undefined ? { ...base, ...display } : base;
  const label = formatValue(kind, value);
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (field.access === "ro") return <span className={valueClass}>{label}</span>;

  if (disabled !== undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`${valueClass} text-muted-foreground`}>{label}</span>
        </TooltipTrigger>
        <TooltipContent>{disabled}</TooltipContent>
      </Tooltip>
    );
  }

  const parsed = parseInput(kind, text);
  const issue = parsed.ok ? validate?.(rawOf(kind, parsed.value)) : parsed.reason;
  const message = issue ?? error;

  function edit(next: string) {
    setText(next);
    setError(undefined);
  }

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setText(editText(kind, value));
      setError(undefined);
    }
  }

  async function apply() {
    if (!parsed.ok || issue !== undefined || pending) return;
    setPending(true);
    try {
      await onApply(rawOf(kind, parsed.value));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  // The Select's own Enter handling runs first and prevents default; a
  // portaled listbox is outside currentTarget in the DOM even though the
  // React event bubbles here.
  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    e.preventDefault();
    void apply();
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button type="button" className={`${valueClass} hover:bg-muted data-open:bg-muted`}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 gap-2" onKeyDown={keyDown}>
        <Label
          htmlFor={inputId}
          className="gap-3 font-mono text-xs font-normal text-muted-foreground"
        >
          {field.name}
          <span>{hexAddr(field.addr)}</span>
        </Label>
        <Control
          kind={kind}
          id={inputId}
          text={text}
          onChange={edit}
          invalid={issue !== undefined}
        />
        {kind.kind === "number" && rangeHint(kind) !== undefined && (
          <p className="text-xs text-muted-foreground">{rangeHint(kind)}</p>
        )}
        <p className="min-h-[1.125rem] text-xs text-destructive">{message}</p>
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
            disabled={issue !== undefined || pending}
            onClick={() => void apply()}
          >
            {pending && <LoaderCircle className="animate-spin" />}
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ControlProps {
  kind: FieldKind;
  id: string;
  text: string;
  onChange: (text: string) => void;
  invalid: boolean;
}

function Control({ kind, id, text, onChange, invalid }: ControlProps) {
  switch (kind.kind) {
    case "number":
      return (
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          className="font-mono"
          value={text}
          aria-invalid={invalid}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
    case "enum":
      return (
        <Select value={text} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kind.options.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "bool":
      return (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={text === "true"}
            onCheckedChange={(checked) => {
              onChange(String(checked));
            }}
          />
          <span>{formatValue(kind, text === "true")}</span>
        </div>
      );
    case "raw":
      return (
        <Input
          id={id}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          value={text}
          aria-invalid={invalid}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
  }
}
