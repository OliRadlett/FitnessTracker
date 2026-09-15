"""
Test render: verify CUBE text reads correctly on non-drive side.
Renders a cropped view of the downtube area for both FIXED and BASELINE.
"""
import bpy, os, sys
from mathutils import Vector

argv = sys.argv
if "--" in argv:
    idx = argv.index("--")
    GLB_PATH = argv[idx + 1]
    TEX_DIR = argv[idx + 2]
else:
    raise SystemExit("Usage: blender --background --python render_test.py -- <glb> <tex_dir>")

OUT = r"C:\Users\oradl\FitnessTracker\bike_model_stock/pipeline/previews/test"
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

# Build full PBR material
mat = bpy.data.materials.new("TestMat")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
for n in list(nodes): nodes.remove(n)

output = nodes.new("ShaderNodeOutputMaterial")
output.location = (300, 0)
principled = nodes.new("ShaderNodeBsdfPrincipled")
principled.location = (150, 0)
uv_map = nodes.new("ShaderNodeUVMap")
uv_map.uv_map = me.uv_layers.active.name
uv_map.location = (-300, 0)

tex_files = {
    "basecolor": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_BaseColor_flipped.png"),
    "normal": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Normal.png"),
    "roughness": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Roughness.png"),
    "metallic": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Metallic.png"),
    "ao": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Ambient_occlusion.png"),
}

nodes_map = {}
for name, path in tex_files.items():
    if os.path.exists(path):
        img = bpy.data.images.load(path)
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        node.image.colorspace_settings.name = "Non-Color" if name in ("normal", "roughness", "metallic", "ao") else "sRGB"
        node.location = (-150, -200 * len(nodes_map))
        nodes_map[name] = node
        links.new(uv_map.outputs["UV"], node.inputs["Vector"])

if "basecolor" in nodes_map:
    links.new(nodes_map["basecolor"].outputs["Color"], principled.inputs["Base Color"])
if "normal" in nodes_map:
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.location = (0, -150)
    links.new(nodes_map["normal"].outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
if "roughness" in nodes_map:
    links.new(nodes_map["roughness"].outputs["Color"], principled.inputs["Roughness"])
if "metallic" in nodes_map:
    links.new(nodes_map["metallic"].outputs["Color"], principled.inputs["Metallic"])

me.materials.clear()
me.materials.append(mat)

# Lighting
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.render.resolution_x = 1400
scene.render.resolution_y = 900

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
cam_obj.data.lens = 85

# Close-up cameras on downtube (where CUBE text is)
# Downtube center ~ (0, 0.35, 0.0)
target = Vector((0.0, 0.35, 0.0))

for side, loc in [("nd_close", (-0.5, 0.3, 0.05)), ("d_close", (0.5, 0.3, 0.05))]:
    cam_obj.location = Vector(loc)
    direction = (target - cam_obj.location).normalized()
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"{side}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Saved {side}.png")

# Full bike views too
target = Vector((0.0, -0.05, 0.4))
for side, loc in [("nd", (-1.8, 0, 0.5)), ("d", (1.8, 0, 0.5))]:
    cam_obj.location = Vector(loc)
    direction = (target - cam_obj.location).normalized()
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"{side}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Saved {side}.png")

print("Done!")
