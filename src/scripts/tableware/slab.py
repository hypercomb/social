# One hand-built Japanese stoneware slab plate, empty, on a slate table. Rendered with Cycles (Blender 5.3).
#   blender -b --factory-startup -P slab.py -- <out.png> [samples] [width] [glaze] [seed] [layer]
# glaze: shino (cream crackle, fire-coloured edges) | tenmoku (dark, rust breaking) | ash (matte golden ash)
#        | kuro (black with white snow specks)
# seed:  the hand. Each seed cuts and presses a different slab.
# layer: the plate alone on transparency with its contact shadow, plus <out>.surface.json, which maps the
#        plate's floor into the picture so a dish rendered from the same camera can be laid on it.
# The plate is only the surface: food and utensils are separate layers, interchangeable.
# Renders are generated output: write them to a temp directory, never into the repository.
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import tableware as tw  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'slab.png')
SAMPLES = int(argv[1]) if len(argv) > 1 else 256
WIDTH = int(argv[2]) if len(argv) > 2 else 1600
GLAZE = argv[3] if len(argv) > 3 else 'shino'
SEED = int(argv[4]) if len(argv) > 4 else 7
LAYER = len(argv) > 5 and argv[5] == 'layer'

scene = tw.empty_scene()
plate = tw.slab_object('plate', 0.27, 0.15, SEED, GLAZE)
plate.rotation_euler = (0, 0, math.radians(-4))
table = tw.table()
if LAYER:
    table.is_shadow_catcher = True
    scene.render.film_transparent = True
tw.room(scene)
tw.window_light()
cam = tw.camera(scene, (0.36, -0.54, 0.42), (-0.012, 0.010, 0.004), 75, 5.6)
device = tw.render_settings(scene, OUT, SAMPLES, WIDTH)
if LAYER:
    bpy.context.view_layer.update()
    surface = {'plate': f'{GLAZE}-{SEED}', 'size_px': [scene.render.resolution_x, scene.render.resolution_y],
               'floor_height_m': tw.FLOOR_Z, **tw.floor_map(scene, cam, plate), 'camera': tw.camera_record(cam),
               'note': 'A dish is placed in plate-floor metres, origin at the floor centre, x along the length. '
                       'Render it from this camera.'}
    with open(os.path.splitext(OUT)[0] + '.surface.json', 'w') as f:
        json.dump(surface, f, indent=2)
print(f'RENDERING {GLAZE} on {device}, {SAMPLES} samples, {scene.render.resolution_x}x{scene.render.resolution_y} -> {OUT}')
bpy.ops.render.render(write_still=True)
print('RENDER DONE')
