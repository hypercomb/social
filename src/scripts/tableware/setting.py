# A table set: four hand-built slab plates staggered on slate, chopsticks on a rest, from one camera.
#   blender -b --factory-startup -P setting.py -- <out-folder> [samples] [width]
#
# Writes, into <out-folder>:
#   setting.png         everything together, for looking at (the only PNG)
#   table.webp          the bare table: the back layer
#   plate-<id>.webp     each plate alone on transparency, with its own contact shadow
#   utensils.webp       the chopsticks and their rest, with their shadow on the table and the plate under them
#   setting.json        the camera, and for every plate its glaze, its hand (seed) and where its floor lands
#                       in the picture, so a dish rendered from this camera can be laid on that plate
#
# Layers stack back to front: table, plates, dishes (each on its plate), utensils. A plate can change glaze
# or leave the table without touching the others, and the food on it is never part of it.
# Renders are generated output: write them to a temp directory, never into the repository.
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import tableware as tw  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'setting')
SAMPLES = int(argv[1]) if len(argv) > 1 else 256
WIDTH = int(argv[2]) if len(argv) > 2 else 1800
ONLY = argv[3].split(',') if len(argv) > 3 else None   # render just these layers, e.g. "setting"
os.makedirs(OUT, exist_ok=True)

# The set, after the photograph: two plates behind, two in front, staggered, none square to the table.
PLATES = [
    # id,     glaze,     length, width, seed, x,     y,     turn (degrees)
    ('ash',     'ash',     0.28, 0.16, 23, -0.100,  0.130,  -6),
    ('shino',   'shino',   0.27, 0.14, 7,   0.205,  0.085,  13),
    ('kuro',    'kuro',    0.27, 0.14, 31, -0.200, -0.100, -14),
    ('tenmoku', 'tenmoku', 0.27, 0.15, 11,  0.115, -0.140, -19),
]
UTENSILS_ON = 'shino'

scene = tw.empty_scene()
plates = {}
for pid, glaze, length, width, seed, x, y, turn in PLATES:
    obj = tw.slab_object(f'plate-{pid}', length, width, seed, glaze)
    obj.location = (x, y, 0)
    obj.rotation_euler = (0, 0, math.radians(turn))
    plates[pid] = obj
table = tw.table()


# ---------------------------------------------------------------- chopsticks and their rest
def wood_material():
    mat, nt, bsdf, out = tw.material('chopstick wood')
    coords = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    stretch = nt.nodes.new('ShaderNodeMapping')
    stretch.inputs['Scale'].default_value = (110.0, 110.0, 5.0)
    nt.links.new(coords, stretch.inputs['Vector'])
    grain = tw.noise(nt, stretch.outputs['Vector'], 3.0, 8.0, 0.7)
    nt.links.new(tw.ramp(nt, grain, [(0.32, (0.150, 0.075, 0.032)), (0.52, (0.260, 0.140, 0.062)),
                                     (0.70, (0.380, 0.220, 0.105))]), bsdf.inputs['Base Color'])
    nt.links.new(tw.band(nt, grain, 0.3, 0.7, 0.30, 0.48, smooth=False), bsdf.inputs['Roughness'])
    tw.setv(bsdf, 'Coat Weight', 0.35)
    tw.setv(bsdf, 'Coat Roughness', 0.18)
    nt.links.new(tw.bump(nt, grain, 0.4, 0.0003), bsdf.inputs['Normal'])
    return mat


def pebble_rest(location, turn):
    """A hashioki: a small pressed pebble of glazed clay."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0, location=location)
    rest = bpy.context.object
    rest.name = 'rest'
    rest.scale = (0.021, 0.0105, 0.0065)
    rest.rotation_euler = (0, 0, math.radians(turn))
    for poly in rest.data.polygons:
        poly.use_smooth = True
    # Flatten the underside so it sits.
    for v in rest.data.vertices:
        if v.co.z < -0.55:
            v.co.z = -0.55
    rest.data.materials.append(tw.plate_material('kuro'))
    return rest


def chopstick(tip, head, radius_head=0.0043, radius_tip=0.0015):
    tip, head = Vector(tip), Vector(head)
    along = head - tip
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=radius_tip, radius2=radius_head, depth=along.length,
                                    location=(tip + head) / 2)
    stick = bpy.context.object
    stick.rotation_mode = 'QUATERNION'
    stick.rotation_quaternion = along.normalized().to_track_quat('Z', 'Y')
    bevel = stick.modifiers.new('soft', 'BEVEL')
    bevel.width, bevel.segments = 0.0004, 2
    for poly in stick.data.polygons:
        poly.use_smooth = True
    stick.modifiers.new('normals', 'WEIGHTED_NORMAL')
    return stick


host = plates[UTENSILS_ON]
info = host['plate']
bpy.context.view_layer.update()
to_world = host.matrix_world
rest_local = Vector((info['length'] / 2 - 0.045, info['width'] / 2 - 0.040, tw.FLOOR_Z + 0.0036))
rest = pebble_rest(to_world @ rest_local, math.degrees(host.rotation_euler.z) + 70)
wood = wood_material()
utensils = [rest]
for side in (-1, 1):
    # The tips rest on the pebble; the heads lie on the far rim, crossing the plate on a diagonal.
    tip = to_world @ (rest_local + Vector((0.006, side * 0.0045, 0.0060)))
    head = to_world @ Vector((-info['length'] / 2 + 0.03, -info['width'] / 2 + 0.012 + side * 0.006, 0.0118))
    stick = chopstick(tip, head)
    stick.data.materials.append(wood)
    utensils.append(stick)

# ---------------------------------------------------------------- light and camera
tw.room(scene)
centre = (0.012, -0.032, 0.005)
tw.window_light(scale=1.8, target=centre)
# High enough to read every plate's floor, low enough that the plates still have a side.
cam = tw.camera(scene, (0.43, -0.67, 1.13), centre, 62, 8.0)


# ---------------------------------------------------------------- layers
def show(objects):
    keep = {o.name for o in objects}
    for obj in scene.objects:
        if obj.type in ('MESH',):
            obj.hide_render = obj.name not in keep


def render(name, objects, catchers=(), transparent=True):
    if ONLY and name not in ONLY:
        return None
    show(list(objects) + list(catchers))
    for obj in scene.objects:
        if obj.type == 'MESH':
            obj.is_shadow_catcher = obj in catchers
    scene.render.film_transparent = transparent
    # The composite is for looking at; every layer that ships is WebP.
    path = os.path.join(OUT, f'{name}.png' if name == 'setting' else f'{name}.webp')
    tw.render_settings(scene, path, SAMPLES, WIDTH)
    print(f'RENDERING {name} -> {path}')
    bpy.ops.render.render(write_still=True)
    return os.path.basename(path)


device = tw.render_settings(scene, os.path.join(OUT, 'setting.png'), SAMPLES, WIDTH)
print(f'device {device}, {SAMPLES} samples, width {WIDTH}')
bpy.context.view_layer.update()
record = {
    'size_px': [scene.render.resolution_x, scene.render.resolution_y],
    'camera': tw.camera_record(cam),
    'floor_height_m': tw.FLOOR_Z,
    'layers': {},
    'plates': [],
}
everything = list(plates.values()) + utensils + [table]
record['layers']['setting'] = render('setting', everything, transparent=False)
record['layers']['table'] = render('table', [table], transparent=False)
for pid, glaze, length, width, seed, x, y, turn in PLATES:
    plate = plates[pid]
    entry = {'id': pid, 'glaze': glaze, 'seed': seed, 'size_m': [length, width], 'at_m': [x, y], 'turn_deg': turn,
             **tw.floor_map(scene, cam, plate)}
    entry['layer'] = render(f'plate-{pid}', [plate], catchers=[table])
    record['plates'].append(entry)
record['layers']['utensils'] = render('utensils', utensils, catchers=[table, host])
record['utensils_on'] = UTENSILS_ON
record['note'] = ('Stack back to front: table, plates, dishes, utensils. A dish is placed in plate-floor metres, '
                  'origin at the floor centre, x along the plate\'s length, and rendered from this camera.')
with open(os.path.join(OUT, 'setting.json'), 'w') as f:
    json.dump(record, f, indent=2)
print('RENDER DONE')
