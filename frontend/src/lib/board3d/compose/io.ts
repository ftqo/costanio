// glTF in and out of the composer's model through gltf-transform (pure Node,
// no DOM, no three.js), so the build step and the tests read tiles the same
// way.
import { Document, NodeIO, type Node as GNode, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import type { MaterialDef, Part, Prim, Quat, Socket, TileModel, Vec3 } from "./model.ts";

let ioP: Promise<NodeIO> | null = null;

/** A NodeIO that can read what `models:compress` writes. */
export function composerIO(): Promise<NodeIO> {
  ioP ??= MeshoptDecoder.ready.then(() =>
    new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder }),
  );
  return ioP;
}

type M4 = number[]; // column-major, glTF's order

function transformPoint(m: M4, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Inverse-transpose of the upper 3x3, as a row-major 3x3 acting on a normal. */
function normalMatrix(m: M4): number[] {
  const a = m[0],
    b = m[4],
    c = m[8];
  const d = m[1],
    e = m[5],
    f = m[9];
  const g = m[2],
    h = m[6],
    i = m[10];
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const D = -(b * i - c * h),
    E = a * i - c * g,
    F = -(a * h - b * g);
  const G = b * f - c * e,
    H = -(a * f - c * d),
    I = a * e - b * d;
  const det = a * A + b * B + c * C || 1;
  // cofactor matrix / det is the inverse-transpose.
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

function bakePrim(prim: Primitive, world: M4): Prim {
  const posA = prim.getAttribute("POSITION");
  if (!posA) throw new Error("primitive without POSITION");
  const nrmA = prim.getAttribute("NORMAL");
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : posA.getCount();
  const pos = new Float32Array(count * 3),
    nrm = new Float32Array(count * 3);
  const nm = normalMatrix(world);
  const v: number[] = [],
    n: number[] = [];
  for (let k = 0; k < count; k++) {
    const vi = idx ? idx.getScalar(k) : k;
    posA.getElement(vi, v);
    const p = transformPoint(world, v[0], v[1], v[2]);
    pos.set(p, k * 3);
    if (nrmA) {
      nrmA.getElement(vi, n);
      const x = nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2];
      const y = nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2];
      const z = nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2];
      const l = Math.hypot(x, y, z) || 1;
      nrm.set([x / l, y / l, z / l], k * 3);
    }
  }
  return { material: prim.getMaterial()?.getName() ?? "", pos, nrm };
}

/** Read a tile's document into the model, every transform baked in. */
export function modelFromDocument(doc: Document, where: string): TileModel {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  // A tile's root is `Hex_<Terrain>`; a town layout's is `Town_<FAM>` or
  // `LakeTown_<DIR>` (the trade-parts contract).
  const top = scene.listChildren().filter((n) => /^(Hex|Town|LakeTown)_/.test(n.getName()));
  if (top.length !== 1)
    throw new Error(`${where}: expected one Hex_/Town_ root node, found ${top.length}`);
  const hex = top[0];
  const parts: Part[] = [];
  let socket: Socket | null = null;
  const walk = (node: GNode) => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix() as unknown as M4;
      // The slab ships as the hex root's own mesh, or after compression as an
      // unnamed child carrying a mesh named after the hex (`Hex_Desert_mesh`).
      const name =
        node.getName() ||
        (mesh.getName().startsWith(hex.getName()) ? hex.getName() : mesh.getName());
      parts.push({
        name,
        prims: mesh.listPrimitives().map((p) => bakePrim(p, world)),
        origin: [world[12], world[13], world[14]],
      });
    } else if (node.getName().startsWith("Token_")) {
      const m = node.getWorldMatrix() as unknown as M4;
      socket = {
        name: node.getName(),
        translation: [m[12], m[13], m[14]],
        rotation: [...node.getRotation()] as Quat,
      };
    }
    for (const c of node.listChildren()) walk(c);
  };
  walk(hex);
  const materials = new Map<string, MaterialDef>();
  for (const m of root.listMaterials()) {
    const [r, g, b, a] = m.getBaseColorFactor();
    materials.set(m.getName(), {
      name: m.getName(),
      baseColor: [r, g, b, a],
      roughness: m.getRoughnessFactor(),
      metallic: m.getMetallicFactor(),
      doubleSided: m.getDoubleSided(),
    });
  }
  return { root: hex.getName(), parts, socket, materials };
}

export async function readModel(file: string): Promise<TileModel> {
  const io = await composerIO();
  return modelFromDocument(await io.read(file), file);
}

/**
 * Weld a non-indexed prim into shared vertices by EXACT float equality of
 * position and normal. Deterministic (first occurrence wins, in triangle
 * order), and lossless: only vertices that were already identical merge.
 */
function weld(p: Prim): { pos: Float32Array; nrm: Float32Array; idx: Uint32Array } {
  const key = new Map<string, number>();
  const pos: number[] = [],
    nrm: number[] = [];
  const count = p.pos.length / 3;
  const idx = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    const i = k * 3;
    const s = `${p.pos[i]},${p.pos[i + 1]},${p.pos[i + 2]},${p.nrm[i]},${p.nrm[i + 1]},${p.nrm[i + 2]}`;
    let v = key.get(s);
    if (v === undefined) {
      v = pos.length / 3;
      key.set(s, v);
      pos.push(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
      nrm.push(p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]);
    }
    idx[k] = v;
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx };
}

/**
 * The model as a glTF document shaped the way the exporter shapes a tile: a
 * `Hex_<Terrain>` root carrying the slab, one child node per part, and the
 * chip socket as an empty. Materials in first-use order; parts in model order.
 */
export function documentFromModel(model: TileModel): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("Scene");
  doc.getRoot().setDefaultScene(scene);
  const mats = new Map<string, ReturnType<Document["createMaterial"]>>();
  const material = (name: string) => {
    let m = mats.get(name);
    if (m) return m;
    const def = model.materials.get(name);
    if (!def) throw new Error(`${model.root}: no material ${name}`);
    m = doc
      .createMaterial(name)
      .setBaseColorFactor(def.baseColor)
      .setRoughnessFactor(def.roughness)
      .setMetallicFactor(def.metallic)
      .setDoubleSided(def.doubleSided);
    mats.set(name, m);
    return m;
  };
  const meshOf = (part: Part) => {
    const mesh = doc.createMesh(part.name);
    for (const p of part.prims) {
      if (p.pos.length === 0) continue;
      const w = weld(p);
      const prim = doc
        .createPrimitive()
        .setAttribute(
          "POSITION",
          doc.createAccessor().setType("VEC3").setArray(w.pos).setBuffer(buffer),
        )
        .setAttribute(
          "NORMAL",
          doc.createAccessor().setType("VEC3").setArray(w.nrm).setBuffer(buffer),
        )
        .setIndices(
          doc
            .createAccessor()
            .setType("SCALAR")
            .setArray(w.pos.length / 3 > 65535 ? w.idx : new Uint16Array(w.idx))
            .setBuffer(buffer),
        )
        .setMaterial(material(p.material));
      mesh.addPrimitive(prim);
    }
    return mesh;
  };
  const slab = model.parts.find((p) => p.name === model.root);
  if (!slab) throw new Error(`${model.root}: no slab part`);
  const root = doc.createNode(model.root).setMesh(meshOf(slab));
  scene.addChild(root);
  for (const part of model.parts) {
    if (part === slab || part.prims.every((p) => p.pos.length === 0)) continue;
    root.addChild(doc.createNode(part.name).setMesh(meshOf(part)));
  }
  if (model.socket) {
    root.addChild(
      doc
        .createNode(model.socket.name)
        .setTranslation(model.socket.translation)
        .setRotation(model.socket.rotation),
    );
  }
  return doc;
}

export async function modelToGlb(model: TileModel): Promise<Uint8Array> {
  const io = await composerIO();
  return io.writeBinary(documentFromModel(model));
}
