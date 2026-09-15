"""
Render with Cycles: 256 samples, proper PBR material, good lighting.
Outputs to previews/ with specified tags.
"""
import bpy, os, sys
from mathutils import Vector

argv = sys.argv
if "--" in argv:
    idx = argv.index("--")
    GLB_PATH = argv[idx + 1]
    TAG = argv[idx + 2]
    TEX_DIR = argv[idx + 3]
else:
    raise SystemExit("Usage: blender --background --python correct_pipeline.py -- <glb> <tag> <tex_dir>")

OUT = r"C:\Users\oradl\FitnessTracker\bike_model_stock/pipeline/previews"
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

# Clear all objects except bike
for obj in list(bpy.data.objects):
    if obj != bike:
        bpy.data.objects.remove(obj, do_unlink=True)

# Build full PBR material
mat = bpy.data.materials.new(f"M_{TAG}")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
for n in list(nodes): nodes.remove(n)

output = nodes.new("ShaderNodeOutputMaterial")
output.location = (500, 0)
principled = nodes.new("ShaderNodeBsdfPrincipled")
principled.location = (300, 0)
# Set metallic to 0.9 default for reflective surfaces
principled.inputs["Metallic"].default_value = 0.5
principled.inputs["Roughness"].default_value = 0.5

uv_map = nodes.new("ShaderNodeUVMap")
uv_map.uv_map = me.uv_layers.active.name
uv_map.location = (-400, 0)

# Load all PBR textures
tex_files = {
    "basecolor": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_BaseColor_flipped.png"),
    "normal": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Normal.png"),
    "roughness": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Roughness.png"),
    "metallic": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Metallic.png"),
    "ao": os.path.join(TEX_DIR, "Cube_Agree_C62_Race_Ambient_occlusion.png"),
}

nodes_map = {}
y_pos = 0
for name, path in tex_files.items():
    if os.path.exists(path):
        img = bpy.data.images.load(path)
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        if name in ("normal", "roughness", "metallic", "ao"):
            node.image.colorspace_settings.name = "Non-Color"
        else:
            node.image.colorspace_settings.name = "sRGB"
        node.location = (-200, y_pos)
        nodes_map[name] = node
        links.new(uv_map.outputs["UV"], node.inputs["Vector"])
        y_pos -= 250

# Base color with AO
if "basecolor" in nodes_map and "ao" in nodes_map:
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.85
    mix.location = (100, -250)
    links.new(nodes_map["basecolor"].outputs["Color"], mix.inputs[1])
    links.new(nodes_map["ao"].outputs["Color"], mix.inputs[2])
    links.new(mix.outputs["Color"], principled.inputs["Base Color"])
elif "basecolor" in nodes_map:
    links.new(nodes_map["basecolor"].outputs["Color"], principled.inputs["Base Color"])

# Normal map
if "normal" in nodes_map:
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 2.0
    normal_map.location = (200, -200)
    links.new(nodes_map["normal"].outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

# Roughness
if "roughness" in nodes_map:
    links.new(nodes_map["roughness"].outputs["Color"], principled.inputs["Roughness"])

# Metallic
if "metallic" in nodes_map:
    links.new(nodes_map["metallic"].outputs["Color"], principled.inputs["Metallic"])

links.new(principled.outputs["BSDF"], output.inputs["Surface"])
me.materials.clear()
me.materials.append(mat)

# Cycles settings
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 512
scene.cycles.device = "GPU"
scene.cycles.max_bounces = 16
scene.cycles.diffuse_bounces = 8
scene.cycles.glossy_bounces = 16
scene.cycles.transmission_bounces = 16
scene.cycles.volume_bounces = 0
scene.cycles.min_samples = 128
scene.cycles.adaptive_threshold = 0.01
scene.render.resolution_x = 1400
scene.render.resolution_y = 900

# Dark environment for contrast
scene.world = bpy.data.worlds.new("World")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.03, 0.03, 0.04, 1.0)

# Multi-light setup
sun_data = bpy.data.lights.new("Sun", type="SUN")
sun_data.energy = 15.0
sun_obj = bpy.data.objects.new("Sun", sun_data)
sun_obj.rotation_euler = (0.4, 0.2, 0.6)
scene.collection.objects.link(sun_obj)

fill_data = bpy.data.lights.new("Fill", type="AREA")
fill_data.energy = 2000.0
fill_data.size = 8.0
fill_obj = bpy.data.objects.new("Fill", fill_data)
fill_obj.location = (-3.0, 2.0, 1.5)
fill_obj.rotation_euler = (0.9, 0.0, 0.6)
scene.collection.objects.link(fill_obj)

rim_data = bpy.data.lights.new("Rim", type="AREA")
rim_data.energy = 3000.0
rim_data.size = 5.0
rim_obj = bpy.data.objects.new("Rim", rim_data)
rim_obj.location = (0.0, -3.0, 0.5)
scene.collection.objects.link(rim_obj)

key_data = bpy.data.lights.new("Key", type="AREA")
key_data.energy = 5000.0
key_data.size = 6.0
key_obj = bpy.data.objects.new("Key", key_data)
key_obj.location = (2.0, -1.0, 2.0)
scene.collection.objects.link(key_obj)

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
