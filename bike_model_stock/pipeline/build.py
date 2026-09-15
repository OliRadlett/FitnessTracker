"""
Render final previews — assumes bike_model.glb already exists.
Updates build.py to skip generation if GLB already present.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(HERE)  # bike_model_stock
TENSOR_DIR = os.path.join(BASE_DIR, "bike_model")

BLENDER = r"D:\tools\blender\blender-4.5.13-windows-x64\blender.exe"
PREVIEWS = os.path.join(HERE, "previews")

glb_path = os.path.join(BASE_DIR, "bike_model.glb")
noflip_glb = os.path.join(BASE_DIR, "bike_model_noflip.glb")


def run(label, cmd, cwd=HERE):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    for line in result.stdout.splitlines():
        print(f"  {line}")
    if result.returncode != 0:
        print(f"FAILED:\n{result.stderr[-1000:]}")
        return False
    return True


# Render FIXED (remapped UVs)
ok = run("Render FIXED (non-drive + drive)",
         [BLENDER, "--background", "--python",
          os.path.join(HERE, "correct_pipeline.py"), "--",
          os.path.abspath(glb_path), "FINAL_FIXED", os.path.abspath(TENSOR_DIR)])
if not ok:
    sys.exit(1)

# Render BASELINE (if exists)
if os.path.exists(noflip_glb):
    run("Render BASELINE (comparison)",
        [BLENDER, "--background", "--python",
         os.path.join(HERE, "correct_pipeline.py"), "--",
         os.path.abspath(noflip_glb), "FINAL_BASE", os.path.abspath(TENSOR_DIR)])

print(f"\n{'='*60}")
print(f"  Build complete!")
print(f"  GLB:      {glb_path}")
print(f"  Previews: {PREVIEWS}/FINAL_*.png")
print(f"{'='*60}")
