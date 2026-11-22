type ClassValue = string | false | null | undefined | ClassValue[];

/** Joins class names, skipping falsy values. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (Array.isArray(v)) {
      const inner = cn(...v);
      if (inner) out.push(inner);
    } else out.push(v);
  }
  return out.join(' ');
}
