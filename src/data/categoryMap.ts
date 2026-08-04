/** Maps BOM item ID prefixes to their human-readable category names. */
const categoryMap: Record<string, string> = {
  ELEC: "Electrical Equipment",
  CAB:  "Electrical Equipment",
  MEC:  "Electrical Equipment",
  PER:  "Metal Profiles",
  EST:  "Metal Profiles",
  REV:  "Walls & Finishes",
  PAN:  "Walls & Finishes",
  FONT: "Toilet & Plumbing",
  SANI: "Toilet & Plumbing",
  CARP: "Doors & Windows",
  PUE:  "Doors & Windows",
  VEN:  "Doors & Windows",
};

/** Returns the display category for a BOM item ID (e.g. "PER-001" → "Metal Profiles"). */
export function getCategory(id: string): string {
  const prefix = id.split("-")[0].toUpperCase();
  return categoryMap[prefix] ?? "Miscellaneous";
}
