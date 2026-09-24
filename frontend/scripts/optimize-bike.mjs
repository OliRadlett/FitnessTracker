/**
 * Optimize the bike GLB for the web (Relive 3D redesign — Phase 0).
 *
 * Full-res source:  bike_model/cube-agree-c62-2026.source.glb   (~42 MB, 748K tris)
 * Shipped output:   frontend/public/models/cube-agree-c62-2026.glb (~2.3 MB, 150K tris)
 *
 * Pipeline (gltf-transform `optimize`): weld + simplify (meshoptimizer) +
 * WebP textures (max 2048) + quantization + EXT_meshopt_compression. The three.js
 * GLTFLoader needs MeshoptDecoder for the output (see lib/bike.ts).
 *
 * Usage:
 *   npm run bike:optimize
 *   node scripts/optimize-bike.mjs [input.glb] [output.glb]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const ROOT = resolve(FRONTEND, '..');

const input = resolve(process.argv[2] ?? resolve(ROOT, 'bike_model/cube-agree-c62-2026.source.glb'));
const output = resolve(process.argv[3] ?? resolve(FRONTEND, 'public/models/cube-agree-c62-2026.glb'));

if (!existsSync(input)) {
  console.error(`Input not found: ${input}`);
  console.error('The full-res source GLB is gitignored (bike_model/*.glb). Provide a path.');
  process.exit(1);
}

/** read GLB JSON chunk + report size / triangle count */
function stats(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const acc = json.accessors ?? [];
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.indices != null) tris += Math.floor(acc[prim.indices].count / 3);
    }
  }
  return { bytes: buf.length, tris, images: (json.images ?? []).length, ext: json.extensionsUsed ?? [] };
}

// Invoke the CLI's JS entry with node directly (avoids a Windows shell/spawn warning).
const cli = resolve(FRONTEND, 'node_modules/@gltf-transform/cli/bin/cli.js');
const args = [
  cli,
  'optimize',
  input,
  output,
  '--compress', 'meshopt',
  '--texture-compress', 'webp',
  '--texture-size', '2048',
  '--simplify-ratio', '0.2',
  '--simplify-error', '0.001',
];

console.log(`Optimizing ${input}\n        -> ${output}`);
const res = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: FRONTEND });
if (res.status !== 0) process.exit(res.status ?? 1);

const before = stats(input);
const after = stats(output);
const mb = (b) => (b / 1e6).toFixed(2);
console.log(
  `\nBike GLB: ${mb(before.bytes)} MB / ${before.tris.toLocaleString()} tris` +
    ` -> ${mb(after.bytes)} MB / ${after.tris.toLocaleString()} tris` +
    `  [ext: ${after.ext.join(', ') || 'none'}]`
);
