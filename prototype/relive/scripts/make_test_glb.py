"""Generate a tiny red-box GLB to test the Google 3D model element."""

from __future__ import annotations

import json
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "models" / "test-box.glb"

# 8 corners of a unit cube centred at origin.
positions = [
    (-0.5, -0.5, -0.5),
    (0.5, -0.5, -0.5),
    (0.5, 0.5, -0.5),
    (-0.5, 0.5, -0.5),
    (-0.5, -0.5, 0.5),
    (0.5, -0.5, 0.5),
    (0.5, 0.5, 0.5),
    (-0.5, 0.5, 0.5),
]
indices = [
    0, 1, 2, 0, 2, 3,  # back
    4, 6, 5, 4, 7, 6,  # front
    0, 4, 5, 0, 5, 1,  # bottom
    3, 2, 6, 3, 6, 7,  # top
    0, 3, 7, 0, 7, 4,  # left
    1, 5, 6, 1, 6, 2,  # right
]

pos_bytes = b"".join(struct.pack("<fff", *p) for p in positions)
idx_bytes = b"".join(struct.pack("<H", i) for i in indices)
# Pad indices to a 4-byte boundary.
idx_pad = (4 - len(idx_bytes) % 4) % 4
bin_blob = pos_bytes + idx_bytes + b"\x00" * idx_pad

gltf = {
    "asset": {"version": "2.0", "generator": "relive-test-box"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0}],
    "meshes": [
        {
            "primitives": [
                {
                    "attributes": {"POSITION": 0},
                    "indices": 1,
                    "material": 0,
                    "mode": 4,
                }
            ]
        }
    ],
    "materials": [
        {
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.95, 0.15, 0.15, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        }
    ],
    "buffers": [{"byteLength": len(bin_blob)}],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962},
        {
            "buffer": 0,
            "byteOffset": len(pos_bytes),
            "byteLength": len(idx_bytes),
            "target": 34963,
        },
    ],
    "accessors": [
        {
            "bufferView": 0,
            "componentType": 5126,
            "count": len(positions),
            "type": "VEC3",
            "min": [-0.5, -0.5, -0.5],
            "max": [0.5, 0.5, 0.5],
        },
        {
            "bufferView": 1,
            "componentType": 5123,
            "count": len(indices),
            "type": "SCALAR",
        },
    ],
}

json_blob = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
json_pad = (4 - len(json_blob) % 4) % 4
json_blob += b" " * json_pad
bin_pad = (4 - len(bin_blob) % 4) % 4
bin_blob += b"\x00" * bin_pad

total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
glb = struct.pack("<III", 0x46546C67, 2, total)
glb += struct.pack("<II", len(json_blob), 0x4E4F534A) + json_blob
glb += struct.pack("<II", len(bin_blob), 0x004E4942) + bin_blob
OUT.write_bytes(glb)
print(f"wrote {OUT} ({len(glb)} bytes)")
