import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hexAddr } from "@/lib/format";
import { matchRows, type SearchEntry } from "@/lib/table-model";

const PLACEHOLDER = "Search the table";

export function TableSearch({
  index,
  onPick,
}: {
  index: readonly SearchEntry[];
  onPick: (entry: SearchEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const hits = useMemo(() => matchRows(index, query), [index, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      // The pop-under hangs off the trigger, which a scrolled table has left behind.
      if (!open) trigger.current?.scrollIntoView({ block: "nearest" });
      openChange(!open);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function pick(entry: SearchEntry) {
    openChange(false);
    onPick(entry);
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant="outline"
          size="sm"
          className="w-56 justify-start font-normal text-text-3"
        >
          <Search />
          {PLACEHOLDER}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[32rem] gap-0 p-0">
        {/* matchRows owns the matching, so cmdk must not score the items again. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={PLACEHOLDER} value={query} onValueChange={setQuery} />
          <CommandList>
            {query.trim() !== "" && <CommandEmpty>Nothing matches.</CommandEmpty>}
            {hits.map((entry) => (
              <CommandItem
                key={entry.name}
                value={entry.name}
                onSelect={() => {
                  pick(entry);
                }}
              >
                <span className="shrink-0 font-medium">{entry.label}</span>
                <span className="truncate font-mono text-xs text-text-3">
                  {entry.name} {hexAddr(entry.addr)}
                </span>
                <CommandShortcut className="shrink-0 tracking-normal">
                  {entry.tab} / {entry.group}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
