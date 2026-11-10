export interface SearchRequest { source: string; query: string; regex: boolean; caseSensitive: boolean; replacement: string }
export interface Match { start: number; end: number; text: string; replacement: string }
export interface SearchResult { matches: Match[]; truncated: boolean }
// Executed only in a terminable worker in the application. Matches are offsets into an immutable source snapshot.
export function searchSource(request: SearchRequest): SearchResult {
  const { source, query, regex, caseSensitive, replacement } = request;
  if (!query) return { matches: [], truncated: false };
  const expression = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(expression, "gu" + (caseSensitive ? "" : "i"));
  const matches: Match[] = [];
  let outputLength = source.length;
  for (const match of source.matchAll(re)) {
    if (matches.length === 10000) return { matches, truncated: true };
    const start = match.index!, text = match[0];
    // JavaScript replacement semantics, including captures, named groups, $$ and $&.
    let expansion = replacement.length;
    const substitute = (token: string, key: string): string => {
      if (key === "$") return "$";
      if (key === "&") return text;
      if (key === "`") return source.slice(0, start);
      if (key === "'") return source.slice(start + text.length);
      if (key.startsWith("<")) return match.groups ? match.groups[key.slice(1, -1)] ?? "" : token;
      const n = Number(key);
      if (n > 0 && n < match.length) return match[n] ?? "";
      if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) < match.length) return (match[Number(key[0])] ?? "") + key[1];
      return token;
    };
    const value = regex ? replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token, key: string) => {
      const part = substitute(token, key); expansion += part.length - token.length;
      if (expansion > 5 * 1024 * 1024) throw new Error("Replacement output exceeds 5 Mi characters");
      return part;
    }) : replacement;
    outputLength += value.length - text.length;
    if (outputLength > 5 * 1024 * 1024) throw new Error("Replacement output exceeds 5 Mi characters");
    matches.push({ start, end: start + text.length, text, replacement: value });
  }
  return { matches, truncated: false };
}
export function replaceMatches(source: string, matches: Match[]): string {
  let at = 0; const pieces: string[] = [];
  for (const m of matches) { pieces.push(source.slice(at, m.start), m.replacement); at = m.end; }
  pieces.push(source.slice(at)); return pieces.join("");
}
