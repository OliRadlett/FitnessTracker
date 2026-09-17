"""
Step 1: Create the modified texture with mirrored CUBE text using PIL (external Python).
Step 2: In Blender, load noflip GLB, apply bmesh UV remap + load modified texture, export.
Step 3: Re-import Blender-exported GLB and render both sides.

This separates texture creation (needs PIL) from Blender work (needs bmesh+export).
"""
import os
import sys
import numpy as np
from PIL import Image, ImageOps

PARENT = r"C:\Users\oradl\FitnessTracker"
TEX_DIR = os.path.join(PARENT, "bike_model")
TEX_IN = os.path.join(TEX_DIR, "Cube_Agree_C62_Race_BaseColor.png")
TEX_OUT = os.path.join(TEX_DIR, "Cube_Agree_C62_Race_BaseColor_flipped.png")

CUBE_U_LO, CUBE_U_HI = 0.48, 0.72
CUBE_V_LO, CUBE_V_HI = 0.87, 0.97
MIR_U_LO, MIR_U_HI = 0.24, 0.48

def create_mirrored_texture():
    """Copy CUBE text from U[0.48,0.72], mirror it, paste at U[0.24,0.48]."""
    img = Image.open(TEX_IN).convert("RGB")
    w, h = img.size
    print(f"Texture: {w}x{h}")
    
    # PIL coordinates: y=0 is top, UV y=0 is bottom
    src_x1 = int(CUBE_U_LO * w)
    src_x2 = int(CUBE_U_HI * w)
    src_y1 = int((1.0 - CUBE_V_HI) * h)  # Top of CUBE in PIL = bottom in UV
    src_y2 = int((1.0 - CUBE_V_LO) * h)  # Bottom of CUBE in PIL = top in UV
    print(f"CUBE region: x=[{src_x1},{src_x2}] y=[{src_y1},{src_y2}]")
    
    cube_region = img.crop((src_x1, src_y1, src_x2, src_y2))
    mirrored = ImageOps.mirror(cube_region)  # Horizontal mirror
    
    dst_x1 = int(MIR_U_LO * w)
    dst_x2 = int(MIR_U_HI * w)
    dst_y1 = src_y1
    dst_y2 = src_y2
    print(f"Destination: x=[{dst_x1},{dst_x2}] y=[{dst_y1},{dst_y2}]")
    
    if mirrored.size != (dst_x2 - dst_x1, dst_y2 - dst_y1):
        mirrored = mirrored.resize((dst_x2 - dst_x1, dst_y2 - dst_y1), Image.LANCZOS)
    
    img.paste(mirrored, (dst_x1, dst_y1))
    img.save(TEX_OUT)
    print(f"Saved modified texture: {TEX_OUT}")
    
    # Verify the mirrored text is different from the destination
    orig_dst = Image.open(TEX_IN).convert("RGB").crop((dst_x1, dst_y1, dst_x2, dst_y2))
    orig_dst_arr = np.array(orig_dst)
    new_dst_arr = np.array(img.crop((dst_x1, dst_y1, dst_x2, dst_y2)))
    diff = np.abs(orig_dst_arr.astype(float) - new_dst_arr.astype(float))
    changed = np.any(diff > 20, axis=-1).sum()
    total = orig_dst_arr.shape[0] * orig_dst_arr.shape[1]
    print(f"Destination region changed: {changed}/{total} pixels ({100*changed/total:.1f}%)")
    return TEX_OUT

if __name__ == "__main__":
    create_mirrored_texture()
