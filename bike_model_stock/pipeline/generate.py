"""
Bike Model Pipeline: Generate GLB with original UVs and colored textures.

This script generates the clean-geometry bike GLB with original UVs and
the colored 2026 Cube Agree C62 PBR textures.

Usage: python generate.py [--cube-flip] [--newmen-flip] [--output NAME]
"""
import os
import sys
import time
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

HERE = Path(__file__).parent.resolve()
BASE_DIR = HERE.parent
CLEAN_OBJ = BASE_DIR / "bike_combined_clean_no_tex.obj"
TEX_OBJ = BASE_DIR / "bike_combined_textured.obj"
TEX_DIR = BASE_DIR.parent / "bike_model"

TEXTURES = {
    "basecolor": TEX_DIR / "Cube_Agree_C62_Race_BaseColor.png",
    "normal": TEX_DIR / "Cube_Agree_C62_Race_Normal.png",
    "roughness": TEX_DIR / "Cube_Agree_C62_Race_Roughness.png",
    "metallic": TEX_DIR / "Cube_Agree_C62_Race_Metallic.png",
    "ao": TEX_DIR / "Cube_Agree_C62_Race_Ambient_occlusion.png",
}

Q = 6  # quantize to 6 decimals (match clean file)

# Atlas regions (pixel analysis)
CUBE_U_CENTER = 0.60
CUBE_U_LO, CUBE_U_HI = 0.48, 0.72
CUBE_V_LO, CUBE_V_HI = 0.87, 0.97
CUBE_V_CENTER = (CUBE_V_LO + CUBE_V_HI) / 2
# Mirrored CUBE text region (created in texture by generate.py)
MIR_U_LO = CUBE_U_LO - (CUBE_U_HI - CUBE_U_LO)  # 0.24
MIR_U_HI = CUBE_U_LO                            # 0.48
MIR_V_LO, MIR_V_HI = CUBE_V_LO, CUBE_V_HI  # Same V region
NEWMEN_U_CENTER = 0.2056
NEWMEN_U_LO, NEWMEN_U_HI = 0.12, 0.29
NEWMEN_V_LO, NEWMEN_V_HI = 0.60, 0.81
FRONT_HUB = np.array([0.0, 0.3, 0.65])
REAR_HUB = np.array([0.0, 0.3, -0.55])


def parse_float_header(path, tag):
    with open(path) as f:
        return np.fromstring(" ".join(l[2:] for l in f if l.startswith(tag + " ")),
                             sep=" ", dtype=np.float64)


def parse_face_indices(path):
    tris = []
    with open(path) as f:
        for l in f:
            if not l.startswith("f "):
                continue
            parts = l.split()[1:]
            tris.append([int(p.split("/")[0]) - 1 for p in parts[:3]])
    return np.asarray(tris, dtype=np.int64)


def apply_uv_fixes(V, UV, F, cube_flip=False, newmen_flip=False):
    """Apply UV fixes to selected face groups.
    
    Key insight: due to inward-pointing normals, each side of the tube sees
    its own faces as front-faces. The CUBE text texture is oriented for the
    drive side (x>0 faces). The non-drive side (x<0 faces) sees the same text
    mirrored. Fix: U-flip ONLY x<0 faces (1.0 - u) — the geometric mirror
    cancels the texture mirror, yielding correct text on both sides.
    """
    v0, v1, v2 = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    cents = (v0 + v1 + v2) / 3.0
    fu = UV[F]
    uc = fu[:, :, 0].mean(axis=1)
    vc = fu[:, :, 1].mean(axis=1)

    flip_map = {}

    if cube_flip:
        # CUBE text on downtube: texture is oriented for drive side (x>0 faces).
        # Non-drive side (x<0 faces) shows mirrored text due to geometry flip.
        # Fix: 
        # 1. Create mirrored copy of CUBE text in texture at U[0.24,0.48]
        # 2. Remap x<0 faces' UVs from [0.48,0.72] to [0.24,0.48]
        dt_mask = (cents[:, 0] < -0.001) & (cents[:, 0] > -0.15) & (cents[:, 1] > 0.15) & (cents[:, 1] < 0.85)
        cube_uv = (uc > CUBE_U_LO) & (uc < CUBE_U_HI) & (vc > CUBE_V_LO) & (vc < CUBE_V_HI)
        cube_nd = np.where(dt_mask & cube_uv)[0]
        print(f"  CUBE non-drive faces: {len(cube_nd)} (UV remap to mirrored region)")
        for fi in cube_nd:
            flip_map[fi] = ('uremap', CUBE_U_LO, CUBE_U_HI, MIR_U_LO, MIR_U_HI)

    if newmen_flip:
        # NEWMEN: front and rear wheel analysis
        dist_front = np.linalg.norm(cents - FRONT_HUB, axis=1)
        dist_rear = np.linalg.norm(cents - REAR_HUB, axis=1)
        front_rim = (dist_front > 0.15) & (dist_front < 0.40)
        rear_rim = (dist_rear > 0.15) & (dist_rear < 0.40)
        newmen_uv = (uc > NEWMEN_U_LO) & (uc < NEWMEN_U_HI) & (vc > NEWMEN_V_LO) & (vc < NEWMEN_V_HI)
        
        front_all = np.where(front_rim & newmen_uv)[0]
        rear_all = np.where(rear_rim & newmen_uv)[0]
        print(f"  NEWMEN front: {len(front_all)} faces, rear: {len(rear_all)} faces (no flip)")


    if not flip_map:
        return V, UV, F

    new_v, new_uv = [], []
    Ff = F.copy()
    for fi, flip_data in flip_map.items():
        axis = flip_data[0]
        if axis == 'uv':
            u_center, v_center = flip_data[1], flip_data[2]
        elif axis == 'uremap':
            src_lo, src_hi, dst_lo, dst_hi = flip_data[1], flip_data[2], flip_data[3], flip_data[4]
        else:
            center = flip_data[1]
        for k in range(3):
            old = int(F[fi, k])
            new_v.append(V[old])
            u2 = UV[old].copy()
            if axis == 'u':
                u2[0] = 2.0 * center - u2[0]
            elif axis == 'v':
                u2[1] = 2.0 * center - u2[1]
            elif axis == 'uv':
                u2[0] = 2.0 * u_center - u2[0]
                u2[1] = 2.0 * v_center - u2[1]
            elif axis == 'uremap':
                # Reflection: map source range [src_lo,src_hi] to destination [dst_hi,dst_lo] (reversed)
                # so that source left maps to destination right (letter order preserved in mirror)
                src_center = (src_lo + src_hi) / 2
                dst_center = (dst_lo + dst_hi) / 2
                u2[0] = 2 * dst_center - (u2[0] - src_center) - src_center
            new_uv.append(u2)
        base = len(V) + len(new_v) - 3
        for k in range(3):
            Ff[fi, k] = base + k

    V2 = np.vstack([V, np.array(new_v)])
    UV2 = np.vstack([UV, np.array(new_uv)])
    print(f"  after fixes: {len(V2):,} verts, {len(Ff):,} faces")
    return V2, UV2, Ff


def main():
    parser = argparse.ArgumentParser(description="Generate bike GLB with UV fixes")
    parser.add_argument("--cube-flip", action="store_true", default=True, help="U-flip CUBE wordmark faces (default: on)")
    parser.add_argument("--newmen-flip", action="store_true", default=True, help="U-flip NEWMEN wheel text faces (default: on)")
    parser.add_argument("--no-cube-flip", action="store_true", help="Disable CUBE flip")
    parser.add_argument("--no-newmen-flip", action="store_true", help="Disable NEWMEN flip")
    parser.add_argument("--output", default="bike_model", help="Output filename (without extension)")
    args = parser.parse_args()
    if args.no_cube_flip:
        args.cube_flip = False
    if args.no_newmen_flip:
        args.newmen_flip = False

    out_glb = BASE_DIR / f"{args.output}.glb"
    out_obj = BASE_DIR / f"{args.output}.obj"

    print("Parsing clean geometry...")
    Vc = parse_float_header(CLEAN_OBJ, "v").reshape(-1, 3)
    Fc = parse_face_indices(CLEAN_OBJ)
    print(f"  clean: {len(Vc):,} verts, {len(Fc):,} faces")

    print("Parsing textured assembly...")
    Vt = parse_float_header(TEX_OBJ, "v").reshape(-1, 3)
    UVt = parse_float_header(TEX_OBJ, "vt").reshape(-1, 2)
    Ft = parse_face_indices(TEX_OBJ)
    print(f"  textured: {len(Vt):,} verts, {len(UVt):,} uvs, {len(Ft):,} faces")
    assert len(Vt) == len(UVt), "textured OBJ must be 1:1 v/vt"

    print("Matching faces...")
    kc = np.round(Vc[Fc], Q)
    clean_keys = set(map(tuple, np.sort(kc, axis=1).reshape(len(Fc), -1)))
    kt = np.round(Vt[Ft], Q)
    tex_keys = np.sort(kt, axis=1).reshape(len(Ft), -1)
    keep = np.array([tuple(row) in clean_keys for row in tex_keys], dtype=bool)
    print(f"  {int(keep.sum())} faces matched, {int((~keep).sum())} strand faces dropped")

    F = Ft[keep]
    print("Compacting vertices...")
    used = np.zeros(len(Vt), bool)
    used[F] = True
    remap = np.cumsum(used) - 1
    V = Vt[used]
    UV = UVt[used]
    F = remap[F]
    V = np.asarray(V, dtype=np.float64)
    UV = np.asarray(UV, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    print(f"  final: {len(V):,} verts, {len(F):,} faces")

    if args.cube_flip or args.newmen_flip:
        print("Applying UV fixes...")
        V, UV, F = apply_uv_fixes(V, UV, F, args.cube_flip, args.newmen_flip)

    print(f"Writing {out_obj}...")
    with open(out_obj, 'w') as fl:
        fl.write("# Clean bike model with colored textures\n")
        fl.write("o bike_combined\n")
        for vi in range(len(V)):
            fl.write(f"v {V[vi,0]} {V[vi,1]} {V[vi,2]}\n")
        for ui in range(len(UV)):
            fl.write(f"vt {UV[ui,0]} {UV[ui,1]}\n")
        for fi in range(len(F)):
            a, b, c = (F[fi, 0] + 1), (F[fi, 1] + 1), (F[fi, 2] + 1)
            fl.write(f"f {a}/{a} {b}/{b} {c}/{c}\n")
    print(f"  wrote {out_obj} ({os.path.getsize(out_obj) / 1e6:.1f} MB)")

    print("Exporting GLB...")
    t0 = time.time()
    import trimesh
    from trimesh.visual.material import PBRMaterial
    from trimesh.visual import TextureVisuals

    base = Image.open(TEXTURES["basecolor"]).convert("RGB")
    
    # If cube_flip was applied to UVs, also create mirrored CUBE text in texture
    if args.cube_flip:
        w, h = base.size
        # CUBE text in texture: U[0.48,0.72] V[0.87,0.97]
        # PIL: y=0 is top, UV: y=0 is bottom
        src_x1 = int(CUBE_U_LO * w)
        src_x2 = int(CUBE_U_HI * w)
        src_y1 = int((1.0 - CUBE_V_HI) * h)
        src_y2 = int((1.0 - CUBE_V_LO) * h)
        cube_region = base.crop((src_x1, src_y1, src_x2, src_y2))
        mirrored = ImageOps.mirror(cube_region)
        
        # Paste into destination: U[0.24,0.48] V[0.87,0.97]
        dst_x1 = int(MIR_U_LO * w)
        dst_x2 = int(MIR_U_HI * w)
        dst_y1 = src_y1
        dst_y2 = src_y2
        if mirrored.size != (dst_x2 - dst_x1, dst_y2 - dst_y1):
            mirrored = mirrored.resize((dst_x2 - dst_x1, dst_y2 - dst_y1), Image.LANCZOS)
        base.paste(mirrored, (dst_x1, dst_y1))
        print(f"  Created mirrored CUBE text in texture at U[{MIR_U_LO:.2f},{MIR_U_HI:.2f}]")
        # Save modified texture as separate file for Blender
        base.save(str(TEX_DIR / "Cube_Agree_C62_Race_BaseColor_flipped.png"))
        print(f"  Saved flipped texture to {TEX_DIR / 'Cube_Agree_C62_Race_BaseColor_flipped.png'}")
    
    rough = Image.open(TEXTURES["roughness"]).convert("L").resize(base.size, Image.LANCZOS)
    metal = Image.open(TEXTURES["metallic"]).convert("L").resize(base.size, Image.LANCZOS)
    normal = Image.open(TEXTURES["normal"]).convert("RGB")
    ao = Image.open(TEXTURES["ao"]).convert("RGB")
    mr_im = Image.merge("RGB", (Image.new("L", base.size, 255), rough, metal))

    mat = PBRMaterial(
        name="agree_c62_2026",
        baseColorTexture=base,
        normalTexture=normal,
        occlusionTexture=ao,
        metallicRoughnessTexture=mr_im,
        alphaMode="MASK",
        alphaCutoff=0.5,
        metallicFactor=1.0,
        roughnessFactor=1.0,
    )
    mesh = trimesh.Trimesh(
        vertices=V,
        faces=F,
        visual=TextureVisuals(uv=UV, material=mat),
        process=False,
    )
    mesh.vertex_normals
    glb_bytes = mesh.export(file_type="glb")
    if not glb_bytes:
        print("GLB export failed: empty output")
        return 1
    out_glb.write_bytes(glb_bytes)
    print(f"  wrote {out_glb} ({os.path.getsize(out_glb) / 1e6:.1f} MB) [{time.time() - t0:.0f}s]")

    check = trimesh.load(out_glb, force="mesh")
    print(f"  validate: {len(check.vertices):,} verts, {len(check.faces):,} faces, "
          f"uv={getattr(check.visual, 'uv', None) is not None}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
