const baseCollator = new Intl.Collator('en', { numeric: false, sensitivity: 'base', ignorePunctuation: false });
const exactCollator = new Intl.Collator('en', { numeric: false, sensitivity: 'variant', ignorePunctuation: false });

// Token ranks: special characters (dashes, periods, underscores, spaces, ...) < digits < letters.
const SPECIAL = 0;
const DIGIT = 1;
const LETTER = 2;

const TOKEN_RE = /\d+|[^\d]/gu;

function rankOf(token: string): number {
  if (token >= '0' && token <= '9') return DIGIT;
  return /[\p{L}\p{M}]/u.test(token) ? LETTER : SPECIAL;
}

function compareDigitRuns(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, '');
  const y = b.replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Windows Explorer-like natural comparison: digit runs compare by numeric value
 * ("file2" < "file10"), case-insensitive. Special characters such as "-", "." and "_"
 * sort before digits, which sort before letters. Ties (e.g. "File02" vs "file2")
 * fall back to an exact comparison so ordering is deterministic.
 */
export function naturalCompare(a: string, b: string): number {
  const ta = a.match(TOKEN_RE) ?? [];
  const tb = b.match(TOKEN_RE) ?? [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const ra = rankOf(ta[i]);
    const rb = rankOf(tb[i]);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const c = ra === DIGIT ? compareDigitRuns(ta[i], tb[i]) : baseCollator.compare(ta[i], tb[i]);
    if (c !== 0) return c;
  }
  if (ta.length !== tb.length) return ta.length < tb.length ? -1 : 1;
  const exact = exactCollator.compare(a, b);
  if (exact !== 0) return exact;
  return a < b ? -1 : a > b ? 1 : 0;
}
