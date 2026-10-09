// Meshopt-compress every .glb the site serves.
//
//     npm run models:compress             # rewrite public/models in place
//     npm run models:compress -- --check  # exit 1 if any file is uncompressed
//     node scripts/compress-models.mjs DIR # some other directory of .glb files
//
// The models are untextured vertex and index data, served without
// content-encoding (see public/_headers), so meshopt cuts them to about a
// third. three.js already ships the decoder.
//
// `make export-assets` rewrites every .glb from the blends, so the Makefile
// runs this right after the exporter; run it by hand after anything else that
// writes a .glb.
//
// Only `meshopt()` at `medium`, which keeps the scene graph. No `optimize()`
// or join/flatten/dedup/prune: the loader, `materialNamed()` and palette.json
// all look meshes and materials up by name, and a rename would silently draw
// the wrong colours. The script records every mesh and material name before
// the transform and refuses to write a file whose names changed.
//
// Not `high`: it reorders and filters, and its quantisation grid shows on
// these low-poly shapes.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "..");
const REPO = path.resolve(FRONTEND, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");

/**
 * Files that are encoded but not quantised.
 *
 * Quantisation moves a node's authored origin into its geometry. Each knight's
 * sword has its origin at the grip, and `knightSwordArt.test` checks
 * `KNIGHT_GRIP` against it, so knights.glb keeps its origins (about 17 KB
 * more).
 */
const ENCODE_ONLY = new Set(["knights.glb"]);
// A directory argument is for `make verify-split`, which compresses a fresh
// export before byte-comparing it with the shipped one.
const where = args.find((a) => !a.startsWith("--"));
const MODELS = where ? path.resolve(where) : path.join(FRONTEND, "public", "models");

/** Every .glb under public/models, deepest paths included, in a stable order. */
async function glbs(dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await glbs(full)));
    else if (entry.name.toLowerCase().endsWith(".glb")) out.push(full);
  }
  return out;
}

/**
 * The names the loader looks assets up by, as one comparable string.
 *
 * Meshes and materials, in document order. Nothing else in the file is read by
 * name, and nothing else is worth failing a build over.
 */
function names(document) {
  const root = document.getRoot();
  return JSON.stringify({
    meshes: root.listMeshes().map((m) => m.getName()),
    materials: root.listMaterials().map((m) => m.getName()),
    prims: root
      .listMeshes()
      .map((m) => m.listPrimitives().map((p) => p.getMaterial()?.getName() ?? null)),
  });
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1).padStart(8);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  // Needed to read files this script already compressed.
  "meshopt.decoder": MeshoptDecoder,
});

const files = await glbs(MODELS);
const rewritten = [];
let before = 0;
let after = 0;
let skipped = 0;

for (const file of files) {
  const rel = path.relative(MODELS, file);
  const original = await readFile(file);
  before += original.length;

  const document = await io.readBinary(original);
  const already = document
    .getRoot()
    .listExtensionsUsed()
    .some((e) => e.extensionName === "EXT_meshopt_compression");
  if (already) {
    after += original.length;
    skipped += 1;
    continue;
  }

  if (check) {
    console.error(`uncompressed: ${rel}`);
    after += original.length;
    rewritten.push(rel);
    continue;
  }

  const wanted = names(document);
  if (ENCODE_ONLY.has(rel)) {
    document
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  } else {
    await document.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  }
  if (names(document) !== wanted) {
    console.error(`${rel}: mesh or material names moved; refusing to write.`);
    process.exit(1);
  }

  const out = Buffer.from(await io.writeBinary(document));
  await writeFile(file, out);
  after += out.length;
  rewritten.push(rel);
  console.log(`${kb(original.length)} KB -> ${kb(out.length)} KB  ${rel}`);
}

if (check) {
  if (rewritten.length) {
    console.error(
      `\n${rewritten.length} file(s) are not meshopt-compressed. Run: npm run models:compress`,
    );
    process.exit(1);
  }
  console.log(`all ${files.length} .glb files are meshopt-compressed`);
  process.exit(0);
}

// gltf-transform writes its generator string back in, so run the exporters'
// stripper (tools/blender/assetmeta.py) again. Not fatal if python3 is missing.
if (rewritten.length) {
  const strip = spawnSync(
    "python3",
    [path.join(REPO, "scripts", "strip-asset-metadata.py"), MODELS],
    { stdio: "inherit" },
  );
  if (strip.status !== 0) {
    console.warn("warning: could not strip asset metadata (is python3 on PATH?)");
  }
}

console.log(
  `\n${files.length} files, ${skipped} already compressed: ` +
    `${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`,
);
