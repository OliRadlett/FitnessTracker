"""
Correct render pipeline: loads GLB + external PBR textures, builds full material, renders.
No .scale() calls (corrupts pixel data). Cycles renderer (EEVEE fails in background mode).
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

# Build full PBR material — NO .scale() on any image (corrupts data)
mat = bpy.data.materials.new(f"M_{TAG}")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
for n in list(nodes): nodes.remove(n)

# Nodes
output = nodes.new("ShaderNodeOutputMaterial")
output.location = (300, 0)
principled = nodes.new("ShaderNodeBsdfPrincipled")
principled.location = (150, 0)
uv_map = nodes.new("ShaderNodeUVMap")
uv_map.uv_map = me.uv_layers.active.name
uv_map.location = (-300, 0)

# Load all PBR textures
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
        img = bpy.data.images.load(path)  # NO .scale() — corrupts pixels
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        node.image.colorspace_settings.name = "Non-Color" if name in ("normal", "roughness", "metallic", "ao") else "sRGB"
        node.location = (-150, -200 * len(nodes_map))
        nodes_map[name] = node
        links.new(uv_map.outputs["UV"], node.inputs["Vector"])

# Connect textures to principled
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

# AO multiplies base color
if "ao" in nodes_map and "basecolor" in nodes_map:
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.location = (0, -300)
    links.new(nodes_map["basecolor"].outputs["Color"], mix.inputs[1])
    links.new(nodes_map["ao"].outputs["Color"], mix.inputs[2])
    links.new(mix.outputs["Color"], principled.inputs["Base Color"])

links.new(principled.outputs["BSDF"], output.inputs["Surface"])
me.materials.clear()
me.materials.append(mat)

# Lighting + Cycles
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.device = "GPU" if len(bpy.types.CyclesRenderSettings(scene.cycles).devices) > 0 else "CPU"
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
