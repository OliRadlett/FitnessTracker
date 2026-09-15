"""
Correct pipeline: NO .scale() call. Load texture and use has_data=False (still works).
"""
import bpy, os, sys
from mathutils import Vector

argv = sys.argv
if "--" in argv:
    idx = argv.index("--")
    GLB_PATH = argv[idx + 1]
    TAG = argv[idx + 2]
    TEX_FILE = argv[idx + 3]
else:
    raise SystemExit("Usage: blender --background --python pipeline.py -- <glb> <tag> <texture>")

OUT = r"C:\Users\oradl\FitnessTracker\bike_model_stock\pipeline\previews"
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_PATH)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if len(meshes) > 1:
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    bike = bpy.context.selected_objects[-1]
else:
    bike = meshes[0]
me = bike.data

# Build material - NO .scale() call (scale corrupts data)
mat = bpy.data.materials.new(f"M_{TAG}")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
for n in list(nodes): nodes.remove(n)
output = nodes.new("ShaderNodeOutputMaterial")
principled = nodes.new("ShaderNodeBsdfPrincipled")
uv_map = nodes.new("ShaderNodeUVMap")
uv_map.uv_map = me.uv_layers.active.name
img_node = nodes.new("ShaderNodeTexImage")
img_node.image = bpy.data.images.load(TEX_FILE)  # NO .scale() - it corrupts!
links.new(uv_map.outputs["UV"], img_node.inputs["Vector"])
links.new(img_node.outputs["Color"], principled.inputs["Base Color"])
links.new(principled.outputs["BSDF"], output.inputs["Surface"])
me.materials.clear()
me.materials.append(mat)

# Verify texture pixel
px = list(img_node.image.pixels)
w = img_node.image.size[0]
y = int(0.92 * w)
x = int(0.36 * w)
idx = (x + y * w) * 4
print(f"Texture pixel at U=0.36,V=0.92: R={px[idx]:.3f} G={px[idx+1]:.3f} B={px[idx+2]:.3f}")

# Lighting + Cycles
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.render.resolution_x = 1400
scene.render.resolution_y = 900
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.16, 0.17, 0.19, 1.0)
bg.inputs[1].default_value = 1.0
sun_data = bpy.data.lights.new("Sun", type="SUN")
sun_data.energy = 5.0
sun_obj = bpy.data.objects.new("Sun", sun_data)
sun_obj.rotation_euler = (0.5, 0.2, 0.7)
scene.collection.objects.link(sun_obj)
fill_data = bpy.data.lights.new("Fill", type="AREA")
fill_data.energy = 300.0
fill_obj = bpy.data.objects.new("Fill", fill_data)
fill_obj.location = (-2.5, 1.5, 1.2)
fill_obj.rotation_euler = (0.9, 0.0, 0.6)
scene.collection.objects.link(fill_obj)
cam_data = bpy.data.cameras.new("Cam")
cam_obj = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam_obj)
scene.camera = cam_obj
cam_obj.data.lens = 35
target = Vector((0.0, -0.05, 0.4))

for side, loc in [("nd", (-1.8, 0, 0.5)), ("d", (1.8, 0, 0.5))]:
    cam_obj.location = Vector(loc)
    direction = (target - cam_obj.location).normalized()
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"{TAG}_{side}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Saved {TAG}_{side}.png")

print("Done!")
