import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Whether the module at `metaUrl` is the script node was started with (`argv1`). Comparing paths, not URL text, survives Windows backslashes, drive letters and percent-encoding. */
export function isMain(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined || argv1 === "") return false;
  const self = resolve(fileURLToPath(metaUrl));
  const entry = resolve(argv1);
  return process.platform === "win32" ? self.toLowerCase() === entry.toLowerCase() : self === entry;
}
