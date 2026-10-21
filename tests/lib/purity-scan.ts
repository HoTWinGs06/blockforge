/**
 * BlockForge — purity scanner for `src/core/`.
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * WHY AN AST AND NOT A REGEX
 * --------------------------
 * The first version of this guard was a regex sweep over comment-stripped
 * source. It had three holes, all found by RED-TEAM (T48, T49, T50):
 *
 *   T1  the file list came from a non-recursive `readdirSync`, so nothing
 *       under `src/core/<subdir>/` was ever scanned;
 *   T2  `stripComments()` deleted from `//` to end of line without knowing
 *       the `//` was inside a string, so one URL on a line silently
 *       deleted a real `Math.random()` with it;
 *   T3  the patterns missed `Math . random()`, `require("three")` and
 *       `await import("three")`.
 *
 * A regex cannot tell a comment from a string, and it cannot tell
 * `Math.random` from `Math . random`. The TypeScript compiler can: it is
 * already a devDependency, it parses the file for real, and the resulting
 * tree separates comments, strings and code structurally. So the scanner
 * walks the AST and asks about NODES, not about text:
 *
 *   - a call is a call because the parser says so, whatever the spacing;
 *   - a string literal is a string literal, so `"Date.now()"` in data is
 *     not a call and `//` inside a string is not a comment;
 *   - an import is an import, whichever of the four spellings it uses.
 *
 * The scanner therefore has no string/comment ambiguity to get wrong, and
 * `tests/purity.test.ts` meta-tests it against known-bad sources to prove
 * it can still fail.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

/** A single violation found in a single file. */
export interface PurityViolation {
  /** Stable rule id. */
  readonly rule: string;
  /** Repo-relative path of the offending file. */
  readonly file: string;
  /** 1-based line of the violation. */
  readonly line: number;
  /** 1-based column of the violation. */
  readonly column: number;
  /** The offending text, as short as possible. */
  readonly detail: string;
  /** Why the rule exists. */
  readonly reason: string;
}

/**
 * Calls that are banned outright, whatever the spacing.
 *
 * Matched against the dotted name of the callee, so `Math . random()` and
 * `globalThis.Math.random()` are both caught.
 */
const BANNED_CALLS: ReadonlyArray<{ name: string; rule: string; reason: string }> = [
  {
    name: "Math.random",
    rule: "math-random",
    reason: "Math.random is not reproducible; all randomness must come from SeededRng.",
  },
  {
    name: "Date.now",
    rule: "date-now",
    reason: "Date.now makes results depend on wall-clock time.",
  },
  {
    name: "performance.now",
    rule: "performance-now",
    reason: "performance.now is a timing value; it differs between runs and machines.",
  },
  {
    name: "crypto.getRandomValues",
    rule: "crypto-random",
    reason: "getRandomValues is not seedable and must not be used in core.",
  },
];

/** Constructors that are banned outright. */
const BANNED_CONSTRUCTORS: ReadonlyArray<{ name: string; rule: string; reason: string }> = [
  {
    name: "Date",
    rule: "new-date",
    reason: "A Date built from the clock is a hidden source of non-determinism.",
  },
  {
    name: "XMLHttpRequest",
    rule: "network",
    reason: "Network access breaks the pure, offline, reproducible core contract.",
  },
  {
    name: "WebSocket",
    rule: "network",
    reason: "Network access breaks the pure, offline, reproducible core contract.",
  },
  {
    name: "EventSource",
    rule: "network",
    reason: "Network access breaks the pure, offline, reproducible core contract.",
  },
];

/** Network entry points that are banned outright. */
const BANNED_NETWORK: ReadonlyArray<{ name: string; reason: string }> = [
  { name: "fetch", reason: "Network access breaks the pure, offline, reproducible core contract." },
  { name: "sendBeacon", reason: "Network access breaks the pure, offline, reproducible core contract." },
];

/**
 * Browser globals that must never appear in core.
 *
 * A DOM global in a TYPE position is just as much a DOM dependency as one
 * in a value position, so both are reported.
 */
const BANNED_DOM_GLOBALS: ReadonlySet<string> = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "HTMLElement",
  "EventTarget",
]);

/** Packages `src/core/` may not import. */
const FORBIDDEN_PACKAGES: readonly string[] = ["three", "react", "react-dom"];

/**
 * Layers `src/core/` is forbidden to depend on.
 *
 * Matched on whole path SEGMENTS of a relative specifier, so
 * `../engine/thing.js` is caught and `./engine-utils.js` is not.
 */
const FORBIDDEN_LAYERS: readonly string[] = [
  "engine",
  "render",
  "net",
  "gameplay",
  "server",
];

/** The dotted name of a callee, e.g. `Math.random` or `globalThis.fetch`. */
function dottedName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = dottedName(expr.expression);
    return left === undefined ? undefined : `${left}.${expr.name.text}`;
  }
  if (
    ts.isElementAccessExpression(expr) &&
    expr.argumentExpression !== undefined &&
    ts.isStringLiteral(expr.argumentExpression)
  ) {
    const left = dottedName(expr.expression);
    return left === undefined ? undefined : `${left}.${expr.argumentExpression.text}`;
  }
  return undefined;
}

/** The last segment of a dotted name, e.g. `random` for `Math.random`. */
function lastSegment(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

/**
 * Every name a file declares locally: variables, parameters, functions,
 * classes and imports.
 *
 * A DOM global name that is also declared locally is shadowed, so a
 * reference to it is the local binding and not the browser global.
 * shortcut: file-level, not scope-level — a file that declares `document`
 * in one function and uses the global in another is not detected. Rare
 * enough in `src/core/` to accept; upgrade to a scope walk only if a core
 * file ever needs it.
 */
function locallyDeclaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  const declare = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) declare(element.name);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      declare(node.name);
    } else if (ts.isParameter(node)) {
      declare(node.name);
    } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      names.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name !== undefined) {
      names.add(node.name.text);
    } else if (ts.isImportSpecifier(node)) {
      names.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name !== undefined) {
      names.add(node.name.text);
    } else if (ts.isNamespaceImport(node)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return names;
}

/**
 * True when `name` is a bare reference to a global, not a property name,
 * an object key, a declaration name or an import binding.
 *
 * This is what keeps `{ document: 1 }` and `foo.document` from crying wolf
 * while still catching a real `document.getElementById(...)`.
 */
function isGlobalReference(node: ts.Identifier, shadowed: ReadonlySet<string>): boolean {
  if (shadowed.has(node.text)) return false;

  const parent = node.parent;
  if (parent === undefined) return true;

  // `foo.document` — a property name, not the global.
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  // `{ document: 1 }` — an object key, not the global.
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;

  // A declaration, parameter or member name.
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  ) {
    return false;
  }

  // An import or export binding.
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    return !(parent.name === node || parent.propertyName === node);
  }
  if (ts.isNamespaceImport(parent) || ts.isImportClause(parent)) {
    return parent.name !== node;
  }

  // A label.
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === node
  ) {
    return false;
  }

  return true;
}

/** The module specifiers a file imports, in source order. */
function importSpecifiers(sf: ts.SourceFile): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteral(node.moduleReference.expression)) {
        found.push(node.moduleReference.expression);
      }
    } else if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteral(first)) found.push(first);
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return found;
}

/** Repo-relative path with forward slashes. */
function repoRelative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join("/");
}

/**
 * Scan one file for purity violations.
 *
 * @param file     path used for reporting
 * @param source   the file's text
 * @param repoRoot repository root, for repo-relative reporting
 */
export function scanSource(
  file: string,
  source: string,
  repoRoot: string = process.cwd(),
): PurityViolation[] {
  const violations: PurityViolation[] = [];
  const ownFile = repoRelative(repoRoot, file);

  const sf = ts.createSourceFile(
    ownFile,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
  );

  const report = (
    rule: string,
    node: ts.Node,
    detail: string,
    reason: string,
  ): void => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({
      rule,
      file: ownFile,
      line: pos.line + 1,
      column: pos.character + 1,
      detail,
      reason,
    });
  };

  const shadowed = locallyDeclaredNames(sf);

  const visit = (node: ts.Node): void => {
    // Calls.
    if (ts.isCallExpression(node)) {
      const callee = dottedName(node.expression);
      if (callee !== undefined) {
        for (const banned of BANNED_CALLS) {
          if (callee === banned.name || callee.endsWith(`.${banned.name}`)) {
            report(banned.rule, node, callee, banned.reason);
          }
        }
        const tail = lastSegment(callee);
        for (const banned of BANNED_NETWORK) {
          if (tail === banned.name) {
            report("network", node, callee, banned.reason);
          }
        }
      }
    }

    // `new Foo()`.
    if (ts.isNewExpression(node)) {
      const callee = dottedName(node.expression);
      if (callee !== undefined) {
        for (const banned of BANNED_CONSTRUCTORS) {
          if (callee === banned.name || callee.endsWith(`.${banned.name}`)) {
            report(banned.rule, node, callee, banned.reason);
          }
        }
      }
    }

    // DOM and storage globals.
    if (ts.isIdentifier(node) && BANNED_DOM_GLOBALS.has(node.text)) {
      if (isGlobalReference(node, shadowed)) {
        report(
          "dom-global",
          node,
          node.text,
          "DOM and storage globals do not exist in Node and make core impure.",
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);

  // Imports.
  for (const specifier of importSpecifiers(sf)) {
    const text = specifier.text;
    if (text.length === 0) continue;

    for (const pkg of FORBIDDEN_PACKAGES) {
      if (text === pkg || text.startsWith(`${pkg}/`)) {
        report(
          `package-${pkg}`,
          specifier,
          text,
          `src/core/ may not import "${pkg}"; core must run in plain Node with no GPU.`,
        );
      }
    }

    if (!text.startsWith(".")) continue;

    const segments = text.split("/").filter((s) => s.length > 0 && s !== "." && s !== "..");
    for (const layer of FORBIDDEN_LAYERS) {
      if (segments.includes(layer)) {
        report(
          `layer-${layer}`,
          specifier,
          text,
          `src/core/ may not import from ${layer} (dependencies point downward only).`,
        );
      }
    }
  }

  return violations;
}

/** Every `.ts` file under `dir`, RECURSIVELY, in a stable order. */
export function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Scan every `.ts` file under `dir`, recursively. */
export function scanDirectory(dir: string, repoRoot: string = process.cwd()): PurityViolation[] {
  return listTypeScriptFiles(dir)
    .map((file) => ({ file, source: fs.readFileSync(file, "utf8") }))
    .flatMap(({ file, source }) => scanSource(file, source, repoRoot));
}

/** One human-readable line per violation. */
export function formatViolations(violations: readonly PurityViolation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line}:${v.column} [${v.rule}] ${v.detail} — ${v.reason}`)
    .join("\n");
}
