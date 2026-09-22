export function formatVersion([major, minor, patch]: readonly [number, number, number]): string {
  return `${major}.${minor}.${patch}`;
}

export function hex16(n: number): string {
  return `0x${n.toString(16).padStart(4, "0")}`;
}
