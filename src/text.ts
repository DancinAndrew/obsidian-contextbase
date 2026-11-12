// Turning text into the terms that BM25 counts.
//
// SQLite's unicode61 tokenizer splits on spaces and punctuation, so a run of Chinese characters
// would reach it as one long "word". Text is therefore split here first and stored with spaces
// between terms; FTS5 then only has to split on those spaces. Queries go through the same
// function, so a query term and a stored term are equal exactly when the same text produced them.

export type TokenizerName = "segmenter" | "bigram";
export const TOKENIZER_NAMES: readonly TokenizerName[] = ["segmenter", "bigram"];

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
// Either a run of CJK characters, or a run of letters and digits from any other script.
const RUNS = new RegExp(`([${CJK}]+)|((?:(?![${CJK}])[\\p{L}\\p{N}])+)`, "gu");

// Full-width letters and digits become ASCII, and case no longer matters.
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

export function tokenize(text: string, tokenizer: TokenizerName): string[] {
  const normalized = normalize(text);
  return tokenizer === "segmenter" ? segmenterTerms(normalized) : bigramTerms(normalized);
}

let segmenter: Intl.Segmenter | undefined;

// Words as ICU's dictionary sees them: 第二天改去宇治 → 第二 天 改 去 宇治.
function segmenterTerms(text: string): string[] {
  segmenter ??= new Intl.Segmenter("zh-Hant", { granularity: "word" });
  const terms: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (!isWordLike) continue;
    for (const match of segment.matchAll(RUNS)) terms.push(match[0]);
  }
  return terms;
}

// Every pair of neighbouring CJK characters: 宇治交通 → 宇治 治交 交通. A CJK character standing
// alone is kept as it is. Other scripts are split into words.
function bigramTerms(text: string): string[] {
  const terms: string[] = [];
  for (const match of text.matchAll(RUNS)) {
    const cjk = match[1];
    if (cjk === undefined) {
      terms.push(match[0]);
      continue;
    }
    const chars = Array.from(cjk);
    if (chars.length === 1) terms.push(cjk);
    for (let i = 0; i + 1 < chars.length; i++) terms.push(`${chars[i]}${chars[i + 1]}`);
  }
  return terms;
}

// The text stored in an FTS5 column.
export function indexText(terms: string[]): string {
  return terms.join(" ");
}

// An FTS5 query in which any term may match; BM25 then rewards notes that match more of them.
export function matchQuery(terms: string[]): string | null {
  const unique = [...new Set(terms)];
  if (unique.length === 0) return null;
  return unique.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}
