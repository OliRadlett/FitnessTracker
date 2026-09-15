"""
Bike Model Pipeline — generates GLB with UV fixes and renders previews.

Usage: python build.py

Steps:
1. generate.py  — creates bike_model.glb with remapped UVs + flipped texture
2. correct_pipeline.py — renders FIXED (remapped UVs) and BASELINE (original UVs)
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(HERE)  # bike_model_stock
TENSOR_DIR = os.path.join(BASE_DIR, "bike_model")

GENERATE = os.path.join(HERE, "generate.py")
RENDER = os.path.join(HERE, "correct_pipeline.py")
BLENDER = r"D:\tools\blender\blender-4.5.13-windows-x64\blender.exe"
PREVIEWS = os.path.join(HERE, "previews")


def run(label, cmd, cwd=HERE):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if result.stdout:
        for line in result.stdout.splitlines():
            print(f"  {line}")
    if result.returncode != 0:
        print(f"FAILED:\n{result.stderr[-1000:]}")
        return False
    return True


# Step 1: Generate GLB with UV remapping + flipped texture
ok = run("1. Generate GLB (UV remap + flipped texture)",
         [sys.executable, GENERATE, "--cube-flip", "--output", "bike_model"])
if not ok:
    sys.exit(1)

glb_path = os.path.join(BASE_DIR, "bike_model.glb")
noflip_glb = os.path.join(BASE_DIR, "bike_model_noflip.glb")
tex_flipped = os.path.join(TENSOR_DIR, "Cube_Agree_C62_Race_BaseColor_flipped.png")

# Step 2: Render FIXED (remapped UVs) and BASELINE (original UVs)
ok = run("2. Render FIXED (non-drive + drive)",
         [BLENDER, "--background", "--python", RENDER, "--", glb_path, "FINAL_FIXED", tex_flipped])
if not ok:
    sys.exit(1)

if os.path.exists(noflip_glb):
    run("3. Render BASELINE (comparison)",
        [BLENDER, "--background", "--python", RENDER, "--", noflip_glb, "FINAL_BASE", tex_flipped])

print(f"\n{'='*60}")
print("  Build complete!")
print(f"  GLB:     {glb_path}")
print(f"  Texture: {tex_flipped}")
print(f"  Previews: {PREVIEWS}/FINAL_*.png")
print(f"{'='*60}")
