// Finding the notes in a vault, and telling where a path sits relative to it.
import { readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// The real path, with symbolic links resolved. On macOS a temporary vault under /var is really
// under /private/var, and process.cwd() reports the real one, so paths are compared this way.
export function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

export interface VaultFile {
  path: string; // vault-relative, with forward slashes, spelled as the file system returned it
  mtimeMs: number;
  size: number;
}

export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

// Folders that start with a dot (.obsidian, .git, .trash, .contextbase) and node_modules are
// never indexed; neither is any folder the user lists in the config (decision D6).
export function isExcluded(relPath: string, exclude: string[]): boolean {
  const parts = relPath.split("/");
  if (parts.some((part) => part.startsWith(".") || part === "node_modules")) return true;
  return exclude.some((folder) => relPath === folder || relPath.startsWith(`${folder}/`));
}

export function scanVault(vault: string, exclude: string[]): VaultFile[] {
  const files: VaultFile[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(join(vault, dir), { withFileTypes: true });
    } catch {
      continue; // a folder that vanished or cannot be read is skipped, not fatal
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // links can loop or leave the vault
      const relPath = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (isExcluded(relPath, exclude)) continue;
      if (entry.isDirectory()) {
        pending.push(relPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        try {
          const stat = statSync(join(vault, relPath));
          files.push({ path: relPath, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          // deleted between readdir and stat
        }
      }
    }
  }
  return files;
}

// Where a working folder sits: a vault-relative path ("" for the vault root), or the absolute
// path when it lies outside the vault. Ranking compares these locations (decision D7).
export function locationOf(vault: string, cwd: string | undefined): string | null {
  if (!cwd) return null;
  const target = realPath(cwd);
  const rel = relative(realPath(vault), target);
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return toPosix(target);
  return toPosix(rel);
}

// The absolute path of a vault-relative path, or null if it would leave the vault, either by
// spelling (../) or through a symbolic link that points outside.
export function insideVault(vault: string, relPath: string): string | null {
  const root = realPath(vault);
  const target = realPath(resolve(root, relPath));
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}
