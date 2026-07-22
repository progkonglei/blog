/** 路径安全：确保解析后的绝对路径仍落在工作区 cwd 内，防止 ../../ 逃逸 */
import path from "node:path";

export function assertInsideCwd(cwd: string, filePath: string): string {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${filePath}`);
  }
  return abs;
}
