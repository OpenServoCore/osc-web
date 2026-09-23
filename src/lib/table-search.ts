import type { Group, SearchEntry, TabName } from "./table-model";

/** Where a search hit sits in the table: its tab, its group and its row's register name. */
export interface SearchTarget {
  tab: TabName;
  group: string;
  row: string;
}

export function searchTarget(entry: SearchEntry): SearchTarget {
  return { tab: entry.tab, group: entry.group, row: entry.name };
}

export type OpenGroups = ReadonlyMap<string, boolean>;

export function initialOpen(groups: readonly Pick<Group, "label" | "expanded">[]): OpenGroups {
  return new Map(groups.map((g) => [g.label, g.expanded]));
}

export function withOpen(open: OpenGroups, group: string, value: boolean): OpenGroups {
  return new Map(open).set(group, value);
}

/** `open` with the jumped-to group expanded, or `open` itself when it already is. */
export function expandFor(open: OpenGroups, group: string): OpenGroups {
  return open.get(group) === true ? open : withOpen(open, group, true);
}
