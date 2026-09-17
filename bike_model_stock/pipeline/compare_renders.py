from PIL import Image
import numpy as np

# Reference screenshot
ref = Image.open(r'C:\Users\oradl\Pictures\Screenshots\Screenshot 2026-09-12 233044.png')
arr_ref = np.array(ref)[:, :, :3]
avg_ref = arr_ref.mean(axis=(0, 1))
std_ref = arr_ref.std()
unique_ref = len(np.unique(arr_ref.reshape(-1, 3), axis=0))
print(f"Reference: avg=({avg_ref[0]:.0f},{avg_ref[1]:.0f},{avg_ref[2]:.0f}), std={std_ref:.0f}, unique={unique_ref}")

for name in ['bike_model_stock/pipeline/previews/test/nd_close.png',
             'bike_model_stock/pipeline/previews/test/nd.png',
             'bike_model_stock/pipeline/previews/test/d.png',
             'bike_model_stock/pipeline/previews/FINAL_FIXED_nd.png',
             'bike_model_stock/pipeline/previews/FINAL_FIXED_d.png']:
    img = Image.open(name)
    arr = np.array(img)[:, :, :3]
    avg = arr.mean(axis=(0, 1))
    std = arr.std()
    unique = len(np.unique(arr.reshape(-1, 3), axis=0))
    print(f"{name}: avg=({avg[0]:.0f},{avg[1]:.0f},{avg[2]:.0f}), std={std:.0f}, unique={unique}")
