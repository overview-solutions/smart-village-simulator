/**
 * If ../../CIR/yang/locus exists, symlink node_modules/@circaevum/locus to it.
 * package.json stays github:Circaevum/locus so public clones install without CIR.
 * Does not rewrite package.json or package-lock.json.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cir = resolve(root, "../../CIR/yang/locus");
const dest = join(root, "node_modules/@circaevum/locus");

if (!existsSync(join(cir, "package.json"))) process.exit(0);

mkdirSync(dirname(dest), { recursive: true });

if (existsSync(dest)) {
  try {
    if (lstatSync(dest).isSymbolicLink() && resolve(dirname(dest), readlinkSync(dest)) === cir) {
      process.exit(0);
    }
  } catch {
    /* replace */
  }
  rmSync(dest, { recursive: true, force: true });
}

symlinkSync(cir, dest, process.platform === "win32" ? "junction" : "dir");
process.stdout.write("Linked @circaevum/locus → ../../CIR/yang/locus\n");
