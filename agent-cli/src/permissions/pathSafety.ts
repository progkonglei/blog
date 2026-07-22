import path from "node:path";

/** Ensure resolved path stays inside workspace cwd (Claude Code–style path safety). */
export function assertInsideCwd(cwd: string, filePath: string): string {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${filePath}`);
  }
  return abs;
}
