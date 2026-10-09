// Vitest globalSetup: an uncompressed copy of every shipped .glb, for tests
// that parse the container by hand.
//
// `npm run models:compress` meshopt-encodes and quantises public/models, which
// the app's loader decodes transparently but which changes the raw buffers:
// POSITION min/max become grid units and buffer views are no longer float32.
// Rather than add a decoder to each such test, this decompresses the set once
// into a scratch directory and those tests point `MODELS` at it, so they still
// measure the geometry as exported. That the shipped files are compressed and
// still parse into the same meshes and materials is tested in
// `lib/board3d/loader.test.ts`.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";

const FRONTEND = path.resolve(__dirname, "..");

/** Where the shipped models live, and where the plain copies are written. */
export const SHIPPED_MODELS = path.join(FRONTEND, "public", "models");
export const PLAIN_MODELS = path.join(FRONTEND, "node_modules", ".tmp", "plain-models");

async function glbs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await glbs(full)));
    else if (entry.name.toLowerCase().endsWith(".glb")) out.push(full);
  }
  return out;
}

export default async function setup(): Promise<void> {
  await MeshoptDecoder.ready;
  const reader = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  // No extensions registered on the writer: with compression removed and the
  // accessors dequantised, the output is plain float32 glTF, as exported.
  const writer = new NodeIO();

  for (const file of await glbs(SHIPPED_MODELS)) {
    const document = await reader.readBinary(await readFile(file));
    for (const ext of document.getRoot().listExtensionsUsed()) ext.dispose();
    await document.transform(dequantize());
    const out = path.join(PLAIN_MODELS, path.relative(SHIPPED_MODELS, file));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(await writer.writeBinary(document)));
  }
}
