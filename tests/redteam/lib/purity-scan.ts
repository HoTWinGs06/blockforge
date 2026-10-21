/**
 * BlockForge — RED-TEAM static purity scanner for `src/core/`.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). `docs/ARCHITECTURE.md` §1 assigns the
 * static checks that enforce the core purity contract to the RED-TEAM agent.
 *
 * WHAT IT DOES
 * ------------
 * Lexes each source file, blanks out comments and string contents, then
 * matches the banned constructs against the *remaining code*. Blanking is
 * what makes the scanner honest: the frozen contract itself writes
 * "no Math.random, Date.now, performance.now" inside a doc comment, and a
 * naive text scan would flag the contract itself as impure.
 *
 * It also inspects import specifiers, which needs the original text of each
 * string literal — the lexer keeps a table of them.
 *
 * WHAT IT DOES NOT DO (known limits)
 * ----------------------------------
 * It is a lexical check. A violation hidden behind computed member access
 * (`const r = Math["ra" + "ndom"]`) is not detected, and neither is one
 * reached through an aliased global. Neither is realistic in `src/core/`, and
 * a reviewer reading the file would catch them.
 * shortcut: lexical-only scan; upgrade to a real AST parse only if a core
 * file ever needs to hide a call from it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** A single violation found in a single file. */
export interface PurityViolation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly detail: string;
  readonly reason: string;
}

/** A file handed to the scanner. */
export interface SourceFile {
  /** Path used for reporting and for resolving relative imports. */
  readonly path: string;
  readonly source: string;
}

const BANNED_GLOBALS: ReadonlyArray<{ id: string; pattern: RegExp; reason: string }> = [
  {
    id: "math-random",
    pattern: /\bMath\s*\.\s*random\b/,
    reason: "Math.random is not reproducible; all randomness must come from SeededRng.",
  },
  {
    id: "date-now",
    pattern: /\bDate\s*\.\s*now\b/,
    reason: "Date.now makes results depend on wall-clock time.",
  },
  {
    id: "new-date",
    pattern: /\bnew\s+Date\b/,
    reason: "A Date built from the clock is a hidden source of non-determinism.",
  },
  {
    id: "performance-now",
    pattern: /\bperformance\s*\.\s*now\b/,
    reason: "performance.now is a timing value; it differs between runs and machines.",
  },
  {
    id: "crypto-random",
    pattern: /\bcrypto\s*\.\s*getRandomValues\b/,
    reason: "getRandomValues is not seedable and must not be used in core.",
  },
  {
    id: "dom-global",
    // Not preceded by "." (member access) and not followed by ":" (object
    // key) — otherwise `{ document: 1 }` and `foo.document` cry wolf.
    pattern: /(?<![.\w$])(?:window|document|navigator|localStorage|sessionStorage|indexedDB)(?!\s*:)/,
    reason: "DOM and storage globals do not exist in Node and make core impure.",
  },
  {
    id: "network",
    pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/,
    reason: "Network access breaks the pure, offline, reproducible core contract.",
  },
  {
    id: "node-network",
    pattern: /\bnode:(?:http|https|net|dgram|tls)\b/,
    reason: "Node network modules are network access.",
  },
  {
    id: "node-io",
    pattern: /\bnode:(?:fs|fs\/promises|child_process|worker_threads|os)\b/,
    reason: "Filesystem and process access is side-effecting I/O; core must be pure.",
  },
];

/** Layers `src/core/` is forbidden to depend on. */
const FORBIDDEN_LAYERS: ReadonlyArray<{ id: string; segment: string }> = [
  { id: "layer-engine", segment: "src/engine" },
  { id: "layer-render", segment: "src/render" },
  { id: "layer-net", segment: "src/net" },
  { id: "layer-gameplay", segment: "src/gameplay" },
  { id: "layer-server", segment: "server" },
];

/** Packages `src/core/` may not import. */
const FORBIDDEN_PACKAGES: ReadonlyArray<{ id: string; name: string }> = [
  { id: "package-three", name: "three" },
  { id: "package-react", name: "react" },
  { id: "package-react-dom", name: "react-dom" },
];

interface Literal {
  readonly value: string;
}

interface LexResult {
  /** Same length as the source; comments and string contents are blanked. */
  readonly masked: string;
  /** Opening-quote offset -> original literal text. */
  readonly literals: ReadonlyMap<number, Literal>;
}

/**
 * Blank out comments and string contents, keeping every offset intact so
 * reported line/column numbers point at the original source.
 *
 * Template literals are split: the literal text is blanked, but `${...}`
 * expressions are kept as code, because code inside a template is code.
 */
function lex(source: string): LexResult {
  const masked: string[] = new Array(source.length).fill(" ");
  const literals = new Map<number, Literal>();

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      masked[k] = source[k] === "\n" ? "\n" : " ";
    }
  };

  const readQuoted = (start: number, quote: string): { end: number; value: string } => {
    let i = start + 1;
    let value = "";
    while (i < source.length) {
      const c = source[i] as string;
      if (c === "\\") {
        value += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) {
        return { end: i + 1, value };
      }
      value += c;
      i++;
    }
    return { end: source.length, value };
  };

  /** Index just past the `}` closing the `${` expression that starts at `at`. */
  const templateExprEnd = (at: number): number => {
    let i = at + 2;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const c = source[i] as string;
      if (c === '"' || c === "'" || c === "`") {
        i = readQuoted(i, c).end;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    return i;
  };

  const scanCode = (from: number, to: number): void => {
    let i = from;
    while (i < to) {
      const c = source[i] as string;
      const next = source[i + 1];

      if (c === "/" && next === "/") {
        const nl = source.indexOf("\n", i);
        const stop = nl === -1 || nl > to ? to : nl;
        blank(i, stop);
        i = stop;
        continue;
      }

      if (c === "/" && next === "*") {
        const close = source.indexOf("*/", i + 2);
        const stop = Math.min(close === -1 ? source.length : close + 2, to);
        blank(i, stop);
        i = stop;
        continue;
      }

      if (c === '"' || c === "'") {
        const { end, value } = readQuoted(i, c);
        literals.set(i, { value });
        masked[i] = c;
        blank(i + 1, end - 1);
        if (end - 1 > i) masked[end - 1] = c;
        i = end;
        continue;
      }

      if (c === "`") {
        let j = i + 1;
        let value = "";
        while (j < to) {
          const t = source[j] as string;
          if (t === "\\") {
            value += source[j + 1] ?? "";
            masked[j] = " ";
            if (j + 1 < to) masked[j + 1] = " ";
            j += 2;
            continue;
          }
          if (t === "$" && source[j + 1] === "{") {
            const exprEnd = templateExprEnd(j);
            masked[j] = "$";
            masked[j + 1] = "{";
            // The expression is CODE: scan it as code so a banned call
            // hidden in a template is still caught.
            scanCode(j + 2, exprEnd - 1);
            if (exprEnd - 1 > j) masked[exprEnd - 1] = "}";
            j = exprEnd;
            continue;
          }
          if (t === "`") {
            j++;
            break;
          }
          value += t;
          // Blank the literal text, but NOT the ${...} expressions.
          masked[j] = " ";
          j++;
        }
        literals.set(i, { value });
        masked[i] = "`";
        if (j - 1 > i) masked[j - 1] = "`";
        i = j;
        continue;
      }

      masked[i] = c;
      i++;
    }
  };

  scanCode(0, source.length);
  return { masked: masked.join(""), literals };
}

/** 1-based line/column for a character offset. */
function positionOf(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

/** Repo-relative path with forward slashes, for layer checks. */
function repoRelative(repoRoot: string, filePath: string): string {
  return relative(repoRoot, resolve(filePath)).split(sep).join("/");
}

/** True when `rel` is inside the directory `segment` (not merely prefixed by it). */
function inSegment(rel: string, segment: string): boolean {
  return rel === segment || rel.startsWith(`${segment}/`) || rel.includes(`/${segment}/`);
}

/**
 * The import specifiers of a file, in source order.
 *
 * Only string literals in an import position count — a bare string that
 * happens to look like a path must not be reported as a dependency.
 */
function importSpecifiers(lexed: LexResult): string[] {
  const patterns = [
    /\bfrom\s*(['"])/g, // import ... from "x" / export ... from "x"
    /\bimport\s*\(\s*(['"])/g, // dynamic import("x")
    /\bimport\s+(['"])/g, // import "x"
    /\brequire\s*\(\s*(['"])/g, // require("x")
  ];
  const found: Array<{ offset: number; value: string }> = [];
  for (const pattern of patterns) {
    let match = pattern.exec(lexed.masked);
    while (match !== null) {
      const quoteOffset = match.index + match[0].length - 1;
      const literal = lexed.literals.get(quoteOffset);
      if (literal) found.push({ offset: quoteOffset, value: literal.value });
      match = pattern.exec(lexed.masked);
    }
  }
  return found.sort((a, b) => a.offset - b.offset).map((f) => f.value);
}

/**
 * Scan one file for purity violations.
 *
 * @param file     path used for reporting and for resolving relative imports
 * @param source   the file's text
 * @param repoRoot repository root; relative imports are resolved against it
 */
export function scanSource(
  file: string,
  source: string,
  repoRoot: string,
): PurityViolation[] {
  const violations: PurityViolation[] = [];
  const lexed = lex(source);
  const ownFile = repoRelative(repoRoot, file);

  for (const rule of BANNED_GLOBALS) {
    // The "g" flag is REQUIRED: a non-global regex always restarts at 0, so
    // exec() would return the same match forever.
    const pattern = new RegExp(rule.pattern.source, "g");
    let match = pattern.exec(lexed.masked);
    while (match !== null) {
      const { line, column } = positionOf(source, match.index);
      violations.push({
        rule: rule.id,
        file: ownFile,
        line,
        column,
        detail: match[0].trim(),
        reason: rule.reason,
      });
      match = pattern.exec(lexed.masked);
    }
  }

  for (const specifier of importSpecifiers(lexed)) {
    if (specifier.length === 0) continue;

    // Node builtins are named in a string literal, which the lexer blanks —
    // so they must be checked here, against the import specifier itself.
    const nodeBuiltin = /^node:(.+)$/.exec(specifier);
    if (nodeBuiltin) {
      const mod = nodeBuiltin[1] ?? "";
      const isNetwork = /^(http|https|net|dgram|tls)\b/.test(mod);
      const isIo = /^(fs|fs\/promises|child_process|worker_threads|os)\b/.test(mod);
      const rule = isNetwork
        ? BANNED_GLOBALS.find((r) => r.id === "node-network")
        : isIo
          ? BANNED_GLOBALS.find((r) => r.id === "node-io")
          : undefined;
      if (rule) {
        violations.push({
          rule: rule.id,
          file: ownFile,
          line: 0,
          column: 0,
          detail: specifier,
          reason: rule.reason,
        });
      }
    }

    for (const pkg of FORBIDDEN_PACKAGES) {
      if (specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)) {
        violations.push({
          rule: pkg.id,
          file: ownFile,
          line: 0,
          column: 0,
          detail: specifier,
          reason: `src/core/ may not import "${pkg.name}"; core must run in plain Node with no GPU.`,
        });
      }
    }

    if (!specifier.startsWith(".")) {
      // A deep path into node_modules is still the forbidden package.
      if (/node_modules\/(?:three|react|react-dom)\b/.test(specifier)) {
        violations.push({
          rule: "package-three",
          file: ownFile,
          line: 0,
          column: 0,
          detail: specifier,
          reason: "src/core/ may not import a rendering library, directly or via node_modules.",
        });
      }
      continue;
    }

    const resolved = resolve(dirname(resolve(repoRoot, file)), specifier);
    const rel = repoRelative(repoRoot, resolved);
    for (const layer of FORBIDDEN_LAYERS) {
      if (inSegment(rel, layer.segment)) {
        violations.push({
          rule: layer.id,
          file: ownFile,
          line: 0,
          column: 0,
          detail: specifier,
          reason: `src/core/ may not import from ${layer.segment} (dependencies point downward only).`,
        });
      }
    }
  }

  return violations;
}

/** Scan a list of files. */
export function scanFiles(files: readonly SourceFile[], repoRoot: string): PurityViolation[] {
  return files.flatMap((f) => scanSource(f.path, f.source, repoRoot));
}

/** Every `.ts` file under `dir`, recursively, in stable order. */
export function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (full.endsWith(".ts")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Scan every `.ts` file under `dir`. */
export function scanDirectory(dir: string, repoRoot: string): PurityViolation[] {
  return listTypeScriptFiles(dir)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .flatMap((f) => scanSource(f.path, f.source, repoRoot));
}

/** Human-readable one line per violation. */
export function formatViolations(violations: readonly PurityViolation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line}:${v.column} [${v.rule}] ${v.detail} — ${v.reason}`)
    .join("\n");
}
