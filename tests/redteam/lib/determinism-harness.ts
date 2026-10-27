/**
 * BlockForge — RED-TEAM cross-process determinism harness.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/).
 *
 * WHY THIS EXISTS
 * ---------------
 * Gate G6 requires that two FRESH PROCESSES with the same seed produce
 * identical world hashes. A Vitest process is not a fresh process: it has
 * already imported modules, has warm JIT state, and shares a module registry
 * with every other test in the worker. The only honest way to test G6 is to
 * spawn real child processes and compare what they print.
 *
 * THE TOOLCHAIN PROBLEM
 * ----------------------
 * The core is TypeScript, and its own files import each other with ".js"
 * specifiers ("export * from './types.js'"). Node 24's native type
 * stripping does not resolve a ".js" specifier to the ".ts" file behind it,
 * so a child process cannot simply `import` the core.
 *
 * The fix uses the project's own pinned `typescript` (5.9.3, already a
 * devDependency): transpile the needed sources to a temp directory as real
 * ".js" files, keeping the specifiers as they are. "./types.js" then resolves
 * to the emitted "types.js" and the child process runs the real code.
 *
 * WHAT THE HARNESS PROVES
 * -----------------------
 * Nothing here is trusted until it has been shown to DETECT a difference.
 * A determinism harness that cannot fail is worse than no harness, so
 * determinism-harness.test.ts feeds it a deliberately non-deterministic
 * generator and asserts the harness catches it.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileURLToPath as toFileUrl } from "node:url";
import ts from "typescript";

/** Repository root, derived from this file's location. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Absolute path to a file inside the repository. */
export function repoPath(...segments: string[]): string {
  return join(REPO_ROOT, ...segments);
}

/** SHA-256 of a buffer, hex encoded. */
export function hashBytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of a string, hex encoded. */
export function hashText(text: string): string {
  return hashBytes(text);
}

/**
 * Where a given source file lands inside a transpiled output directory.
 * Mirrors the layout used by {@link transpileToTempDir}.
 */
export function emittedPathFor(outDir: string, sourceFile: string): string {
  const rel = sourceFile.startsWith(REPO_ROOT)
    ? sourceFile.slice(REPO_ROOT.length + 1)
    : basename(sourceFile);
  return join(outDir, rel.replace(/\.ts$/, ".js"));
}

/**
 * Transpile a TypeScript entry point and everything it imports (within the
 * project) into a temp directory of real ".js" files.
 *
 * The import specifiers are left untouched, so "./types.js" resolves to the
 * emitted "types.js" exactly as it would after a normal tsc build.
 */
export function transpileToTempDir(entryPoint: string, workDir: string): string {
  const outDir = mkdtempSync(join(workDir, "bf-det-"));
  const roots = [resolve(entryPoint)];
  const seen = new Set<string>();
  const files: string[] = [];

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    verbatimModuleSyntax: true,
  };

  while (roots.length > 0) {
    const file = roots.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);

    const text = readFileSync(file, "utf8");
    const info = ts.preProcessFile(text, true, true);
    for (const imported of info.importedFiles) {
      const spec = imported.fileName;
      if (!spec.startsWith(".")) continue;
      const resolved = resolve(dirname(file), spec).replace(/\.js$/, ".ts");
      if (!seen.has(resolved)) roots.push(resolved);
    }
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const emitted = ts.transpileModule(text, {
      compilerOptions,
      fileName: file,
    }).outputText;
    const target = emittedPathFor(outDir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, emitted, "utf8");
  }

  // A package.json with "type": "module" so the emitted .js files are ESM.
  writeFileSync(
    join(outDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
    "utf8",
  );

  return outDir;
}

/**
 * Transpile a whole directory of TypeScript into a temp directory of real
 * ".js" files, keeping the directory layout.
 *
 * Use this when the code to run does not live under REPO_ROOT (e.g. another
 * agent's worktree): pass that directory as `root` and the emitted layout
 * mirrors it.
 */
export function transpileDirToTempDir(dir: string, workDir: string): string {
  const outDir = mkdtempSync(join(workDir, "bf-det-"));
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full);
    }
  };
  walk(dir);

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    verbatimModuleSyntax: true,
  };

  for (const file of files) {
    const emitted = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions,
      fileName: file,
    }).outputText;
    const rel = file.slice(dir.length + 1).replace(/\.ts$/, ".js");
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, emitted, "utf8");
  }

  writeFileSync(
    join(outDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
    "utf8",
  );

  return outDir;
}

/**
 * Run a script in a fresh Node process and return its stdout.
 *
 * A fresh process is the whole point: it is the only way to observe
 * "same seed, same world" without the test runner's own state leaking in.
 */
export function runInFreshProcess(
  scriptPath: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): string {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Run a script in N fresh processes and return one stdout per run. */
export function runInFreshProcesses(
  scriptPath: string,
  args: readonly string[] = [],
  times = 2,
  env: NodeJS.ProcessEnv = {},
): string[] {
  return Array.from({ length: times }, () => runInFreshProcess(scriptPath, args, env));
}

/** Hash each stdout of N fresh processes. */
export function hashAcrossFreshProcesses(
  scriptPath: string,
  args: readonly string[] = [],
  times = 2,
): string[] {
  return runInFreshProcesses(scriptPath, args, times).map(hashText);
}

/** True when every hash in the list is identical. */
export function allEqual(hashes: readonly string[]): boolean {
  return hashes.length > 0 && hashes.every((h) => h === hashes[0]);
}

/** Remove a temp directory created by {@link transpileToTempDir}. */
export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** The temp directory the harness writes to. */
export const WORK_DIR = join(tmpdir(), "blockforge-redteam");

/** Export for callers that need to spawn a script by URL. */
export { toFileUrl };
