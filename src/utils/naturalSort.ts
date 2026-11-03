const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const exactCollator = new Intl.Collator(undefined, { numeric: false, sensitivity: 'variant' });

/**
 * Windows Explorer-like natural comparison: digit runs compare by numeric value
 * ("file2" < "file10"), case-insensitive. Ties (e.g. "File02" vs "file2") fall back
 * to an exact comparison so ordering is deterministic.
 */
export function naturalCompare(a: string, b: string): number {
  const cmp = naturalCollator.compare(a, b);
  if (cmp !== 0) return cmp;
  const exact = exactCollator.compare(a, b);
  if (exact !== 0) return exact;
  return a < b ? -1 : a > b ? 1 : 0;
}
