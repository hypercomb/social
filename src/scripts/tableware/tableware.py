# The tableware library: hand-built Japanese stoneware slab plates, their glazes, a slate table, a window
# light and a camera, for Cycles in Blender 5.3. slab.py renders one plate; setting.py renders a table set.
# Plates are only the surface: food and utensils are separate layers, so a dish can go on any plate.
import bpy, bmesh, glob, math, os, random
from mathutils import Vector


# ---------------------------------------------------------------- shader helpers
def sock(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def material(name):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat, nt, bsdf, out


def setv(bsdf, name, value):
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


def feed(nt, value, target):
    if hasattr(value, 'node'):
        nt.links.new(value, target)
    elif isinstance(value, (int, float)):
        target.default_value = value
    else:
        target.default_value = (*value, 1) if len(value) == 3 else value


def ramp(nt, fac, stops, interpolation='LINEAR'):
    node = nt.nodes.new('ShaderNodeValToRGB')
    cr = node.color_ramp
    cr.interpolation = interpolation
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    for pos, col in stops[1:]:
        cr.elements.new(pos).color = (*col, 1)
    feed(nt, fac, node.inputs['Fac'])
    return node.outputs['Color']


def noise(nt, coords, scale, detail=4.0, rough=0.55, distortion=0.0):
    node = nt.nodes.new('ShaderNodeTexNoise')
    node.inputs['Scale'].default_value = scale
    node.inputs['Detail'].default_value = detail
    node.inputs['Roughness'].default_value = rough
    if 'Distortion' in node.inputs:
        node.inputs['Distortion'].default_value = distortion
    nt.links.new(coords, node.inputs['Vector'])
    return node.outputs['Fac']


def voronoi(nt, coords, scale, feature='F1', randomness=1.0):
    node = nt.nodes.new('ShaderNodeTexVoronoi')
    node.feature = feature
    node.inputs['Scale'].default_value = scale
    if 'Randomness' in node.inputs:
        node.inputs['Randomness'].default_value = randomness
    nt.links.new(coords, node.inputs['Vector'])
    return node


def mix(nt, fac, a, b):
    node = nt.nodes.new('ShaderNodeMix')
    node.data_type = 'RGBA'
    feed(nt, fac, sock(node.inputs, 'Factor_Float'))
    feed(nt, a, sock(node.inputs, 'A_Color'))
    feed(nt, b, sock(node.inputs, 'B_Color'))
    return sock(node.outputs, 'Result_Color')


def op(nt, operation, a, b=None, clamp=False):
    node = nt.nodes.new('ShaderNodeMath')
    node.operation = operation
    node.use_clamp = clamp
    for i, value in enumerate((a, b)):
        if value is not None:
            feed(nt, value, node.inputs[i])
    return node.outputs[0]


def band(nt, value, lo, hi, to_lo=0.0, to_hi=1.0, smooth=True):
    node = nt.nodes.new('ShaderNodeMapRange')
    if smooth:
        node.interpolation_type = 'SMOOTHSTEP'
    feed(nt, value, node.inputs['Value'])
    node.inputs['From Min'].default_value = lo
    node.inputs['From Max'].default_value = hi
    node.inputs['To Min'].default_value = to_lo
    node.inputs['To Max'].default_value = to_hi
    return node.outputs[0]


def bump(nt, height, strength, distance, normal=None):
    node = nt.nodes.new('ShaderNodeBump')
    node.inputs['Strength'].default_value = strength
    node.inputs['Distance'].default_value = distance
    feed(nt, height, node.inputs['Height'])
    if normal is not None:
        nt.links.new(normal, node.inputs['Normal'])
    return node.outputs['Normal']


def attribute(nt, name):
    node = nt.nodes.new('ShaderNodeAttribute')
    node.attribute_name = name
    return node.outputs['Fac']


def aim(obj, target):
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (Vector(target) - obj.location).to_track_quat('-Z', 'Y')


# ---------------------------------------------------------------- the slab
class Wobble:
    """A sum of a few sines with random phases: smooth, repeatable irregularity."""
    def __init__(self, terms, rng):
        self.terms = [(f, a, rng.uniform(0, 2 * math.pi)) for f, a in terms]

    def __call__(self, t):
        return sum(a * math.sin(f * t + p) for f, a, p in self.terms)


def slab_mesh(length, width, seed, points=256):
    """One slab. `seed` is the hand that cut and pressed it: each seed is a different plate."""
    rng = random.Random(seed)
    # The cut edge of a slab: never straight, never the same twice.
    outline = Wobble([(2, 0.0011), (3, 0.0008), (5, 0.0006), (9, 0.0003), (14, 0.00015)], rng)
    lip = Wobble([(2, 0.0007), (4, 0.0005), (7, 0.0003), (11, 0.00015)], rng)
    corner_power = [rng.uniform(5.2, 7.5) for _ in range(4)]

    # (inset from the cut edge, height, raw clay, edge, well) for each ring, outside in.
    profile = [
        (0.024, 0.0000, 1.0, 0.0, 0.0),
        (0.008, 0.0000, 1.0, 0.0, 0.0),
        (0.0032, 0.0005, 1.0, 0.0, 0.0),     # the bottom edge, rounded by a damp finger
        (0.0010, 0.0024, 0.85, 0.2, 0.0),
        (0.0002, 0.0050, 0.35, 0.55, 0.0),   # the wall; the glaze stops somewhere on it
        (0.0000, 0.0074, 0.0, 0.85, 0.0),
        (0.0007, 0.0094, 0.0, 1.0, 0.0),     # the lip, pressed round
        (0.0022, 0.0100, 0.0, 1.0, 0.0),
        (0.0044, 0.0097, 0.0, 0.9, 0.0),
        (0.0078, 0.0088, 0.0, 0.6, 0.1),
        (0.0118, 0.0071, 0.0, 0.3, 0.4),     # down into the well
        (0.0165, 0.0061, 0.0, 0.12, 0.8),
        (0.0230, 0.0056, 0.0, 0.03, 1.0),
        (0.0300, 0.0054, 0.0, 0.0, 1.0),
    ]
    floor_scales = [0.86, 0.70, 0.54, 0.38, 0.24, 0.12, 0.04]
    a, b = length / 2, width / 2
    bm = bmesh.new()
    raw_layer = bm.verts.layers.float.new('raw')
    edge_layer = bm.verts.layers.float.new('edge')
    well_layer = bm.verts.layers.float.new('well')
    rings = []
    for ring_index, (inset, z, raw, edge, well) in enumerate(profile):
        ring = []
        for i in range(points):
            t = 2 * math.pi * i / points
            c, s = math.cos(t), math.sin(t)
            quadrant = (0 if c >= 0 else 1) + (0 if s >= 0 else 2)
            power = corner_power[quadrant]
            # How much the hand's irregularity carries inward: all of it at the edge, a trace in the well.
            carry = max(0.15, 1.0 - inset / 0.02)
            ra = a - inset + outline(t) * carry
            rb = b - inset + outline(t + 1.7) * carry
            x = ra * math.copysign(abs(c) ** (2 / power), c)
            y = rb * math.copysign(abs(s) ** (2 / power), s)
            # One end a touch wider than the other, as a slab cut by eye is.
            y *= 1.0 + 0.018 * (x / a)
            rise = lip(t) * (edge ** 1.5)
            # The slab dried with a slight twist: one corner sits a little proud.
            twist = 0.0009 * (x / a) * (y / b) * min(1.0, z / 0.004) if z > 0 else 0.0
            sag = -0.0004 * (1 - (x / a) ** 2) * (1 - (y / b) ** 2) * well
            v = bm.verts.new((x, y, z + rise + twist + sag))
            v[raw_layer], v[edge_layer], v[well_layer] = raw, edge, well
            ring.append(v)
        rings.append(ring)
    # The floor: shrinking copies of the last ring, so every face stays a well-shaped quad.
    last = [v.co.copy() for v in rings[-1]]
    for scale in floor_scales:
        ring = []
        for co in last:
            x, y = co.x * scale, co.y * scale
            sag = -0.0004 * (1 - (x / a) ** 2) * (1 - (y / b) ** 2)
            v = bm.verts.new((x, y, profile[-1][1] + sag))
            v[raw_layer], v[edge_layer], v[well_layer] = 0.0, 0.0, 1.0
            ring.append(v)
        rings.append(ring)
    for lower, upper in zip(rings, rings[1:]):
        for i in range(points):
            j = (i + 1) % points
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    bm.faces.new(list(reversed(rings[0])))
    centre = bm.faces.new(rings[-1])
    bmesh.ops.poke(bm, faces=[centre])
    bm.normal_update()
    mesh = bpy.data.meshes.new('slab')
    bm.to_mesh(mesh)
    bm.free()
    return mesh


FLOOR_Z = 0.0055        # the height of a plate's floor above the table
FLOOR_MARGIN = 0.030    # the floor stops this far in from the cut edge


def slab_object(name, length, width, seed, glaze):
    mesh = slab_mesh(length, width, seed)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    sub = obj.modifiers.new('smooth', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    # Pressed by hand: a soft, low undulation over the whole slab.
    tex = bpy.data.textures.new('hand', 'CLOUDS')
    tex.noise_scale = 0.035
    tex.noise_depth = 2
    disp = obj.modifiers.new('hand', 'DISPLACE')
    disp.texture = tex
    disp.texture_coords = 'GLOBAL'
    disp.direction = 'Z'
    disp.strength = 0.0007
    disp.mid_level = 0.5
    obj.data.materials.append(plate_material(glaze))
    obj['plate'] = {'length': length, 'width': width, 'seed': seed, 'glaze': glaze}
    return obj


# ---------------------------------------------------------------- materials
GLAZES = {
    # glaze body, where it pools, where it breaks thin, the fire colour at the edge
    'shino':   dict(body=(0.68, 0.62, 0.52), pool=(0.78, 0.74, 0.66), thin=(0.64, 0.42, 0.26),
                    fire=(0.36, 0.15, 0.055), rough=(0.34, 0.55), crackle=0.30, speck=1.0),
    'tenmoku': dict(body=(0.020, 0.016, 0.014), pool=(0.010, 0.009, 0.009), thin=(0.24, 0.10, 0.035),
                    fire=(0.42, 0.20, 0.07), rough=(0.12, 0.30), crackle=0.0, speck=0.25),
    'ash':     dict(body=(0.26, 0.17, 0.06), pool=(0.50, 0.36, 0.11), thin=(0.07, 0.045, 0.025),
                    fire=(0.030, 0.024, 0.020), rough=(0.38, 0.66), crackle=0.0, speck=0.6),
    # Black stoneware glaze with white snowflake specks, as in the reference photograph.
    'kuro':    dict(body=(0.030, 0.029, 0.029), pool=(0.018, 0.018, 0.019), thin=(0.11, 0.085, 0.065),
                    fire=(0.20, 0.13, 0.08), rough=(0.58, 0.78), crackle=0.0, speck=1.0,
                    spot=(0.82, 0.81, 0.78), spot_share=0.52, spot_scale=260.0, spot_size=0.20, snow=True),
}


def stoneware(nt, coords):
    """The clay body itself, where the glaze does not reach: toasted, gritty, iron-flecked."""
    grain = noise(nt, coords, 260.0, 3.0, 0.6)
    broad = noise(nt, coords, 22.0, 4.0, 0.55)
    tone = ramp(nt, op(nt, 'ADD', op(nt, 'MULTIPLY', broad, 0.6), op(nt, 'MULTIPLY', grain, 0.4)),
                [(0.30, (0.25, 0.155, 0.090)), (0.55, (0.38, 0.245, 0.150)), (0.75, (0.47, 0.32, 0.20))])
    flecks = voronoi(nt, coords, 520.0)
    few = ramp(nt, sock(flecks.outputs, 'Color'), [(0.0, (1, 1, 1)), (0.36, (1, 1, 1)), (0.37, (0, 0, 0))], 'CONSTANT')
    fleck = op(nt, 'MULTIPLY', band(nt, flecks.outputs['Distance'], 0.10, 0.05), few)
    return mix(nt, op(nt, 'MULTIPLY', fleck, 0.8), tone, (0.05, 0.03, 0.02)), grain


def plate_material(kind):
    g = GLAZES[kind]
    mat, nt, bsdf, out = material(f'{kind} slab')
    coords = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    raw = attribute(nt, 'raw')
    edge = attribute(nt, 'edge')
    well = attribute(nt, 'well')

    # Where the glaze stops: a wavy line on the wall, with the odd drip running past it.
    stop_noise = noise(nt, coords, 34.0, 3.0, 0.5)
    drips = noise(nt, nt.nodes.new('ShaderNodeTexCoord').outputs['Object'], 90.0, 2.0, 0.5)
    stop = op(nt, 'ADD', raw, op(nt, 'MULTIPLY', op(nt, 'SUBTRACT', stop_noise, 0.5), 0.55))
    stop = op(nt, 'SUBTRACT', stop, op(nt, 'MULTIPLY', band(nt, drips, 0.62, 0.72), 0.35))
    unglazed = band(nt, stop, 0.42, 0.50)

    # How thick the glaze lies: thick in the well, thin where it ran off the lip.
    thickness_noise = noise(nt, coords, 11.0, 5.0, 0.6)
    pooling = noise(nt, coords, 4.0, 3.0, 0.5)
    blotch = noise(nt, coords, 6.5, 6.0, 0.62, 1.5)
    edge_break = noise(nt, coords, 48.0, 4.0, 0.6)
    edge_live = op(nt, 'MULTIPLY', edge, band(nt, edge_break, 0.25, 0.75, 0.55, 1.25, smooth=False))
    field_blush = op(nt, 'MULTIPLY', band(nt, blotch, 0.54, 0.78), 0.72)
    thin = op(nt, 'ADD', op(nt, 'MAXIMUM', edge_live, field_blush),
              op(nt, 'MULTIPLY', op(nt, 'SUBTRACT', thickness_noise, 0.5), 0.35), clamp=True)
    body = mix(nt, op(nt, 'MULTIPLY', op(nt, 'MULTIPLY', well, band(nt, pooling, 0.35, 0.7)), 0.8), g['body'], g['pool'])
    colour = mix(nt, band(nt, thin, 0.30, 0.66), body, g['thin'])
    colour = mix(nt, band(nt, thin, 0.70, 0.95), colour, g['fire'])
    # Where the glaze ran thinnest on the lip, the toasted body shows through.
    colour = mix(nt, op(nt, 'MULTIPLY', band(nt, edge_live, 1.0, 1.18), 0.85), colour, (0.20, 0.10, 0.045))

    # Crackle (kan'nyu): fine lines through the glaze, stained faintly over the years.
    if g['crackle'] > 0:
        cells = voronoi(nt, coords, 70.0, 'DISTANCE_TO_EDGE')
        line = band(nt, cells.outputs['Distance'], 0.022, 0.0)
        colour = mix(nt, op(nt, 'MULTIPLY', op(nt, 'MULTIPLY', line, g['crackle']), band(nt, thin, 0.6, 0.2)), colour, (0.34, 0.24, 0.15))

    # Iron spots, some bled into soft haloes, and pinholes.
    spots = voronoi(nt, coords, g.get('spot_scale', 95.0))
    spot = band(nt, spots.outputs['Distance'], g.get('spot_size', 0.075), g.get('spot_size', 0.075) / 3)
    halo = band(nt, spots.outputs['Distance'], 0.30, 0.06)
    picker = ramp(nt, sock(spots.outputs, 'Color'), [(0.0, (1, 1, 1)), (g.get('spot_share', 0.38), (1, 1, 1)), (g.get('spot_share', 0.38) + 0.01, (0, 0, 0))], 'CONSTANT')
    chosen = op(nt, 'MULTIPLY', picker, g['speck'])
    colour = mix(nt, op(nt, 'MULTIPLY', op(nt, 'MULTIPLY', halo, chosen), 0.55), colour, g['thin'])
    colour = mix(nt, op(nt, 'MULTIPLY', spot, chosen), colour, g.get('spot', (0.09, 0.045, 0.02)))
    if g.get('snow'):
        # A second, finer fall of white, thicker where the glaze pooled.
        fine = voronoi(nt, coords, 620.0)
        fine_pick = ramp(nt, sock(fine.outputs, 'Color'), [(0.0, (1, 1, 1)), (0.40, (1, 1, 1)), (0.41, (0, 0, 0))], 'CONSTANT')
        flake = op(nt, 'MULTIPLY', band(nt, fine.outputs['Distance'], 0.16, 0.05), fine_pick)
        colour = mix(nt, op(nt, 'MULTIPLY', flake, 0.85), colour, g['spot'])
    pins = voronoi(nt, coords, 420.0)
    pin = band(nt, pins.outputs['Distance'], 0.06, 0.02)
    pin_pick = ramp(nt, sock(pins.outputs, 'Color'), [(0.0, (1, 1, 1)), (0.29, (1, 1, 1)), (0.30, (0, 0, 0))], 'CONSTANT')
    pinhole = op(nt, 'MULTIPLY', pin, pin_pick)
    colour = mix(nt, op(nt, 'MULTIPLY', pinhole, 0.7), colour, (0.12, 0.08, 0.05))

    clay, clay_grain = stoneware(nt, coords)
    colour = mix(nt, unglazed, colour, clay)
    nt.links.new(colour, bsdf.inputs['Base Color'])

    lo, hi = g['rough']
    glaze_rough = band(nt, thin, 0.0, 1.0, lo, hi, smooth=False)
    glaze_rough = op(nt, 'ADD', glaze_rough, op(nt, 'MULTIPLY', thickness_noise, 0.06))
    rough = op(nt, 'ADD', op(nt, 'MULTIPLY', glaze_rough, op(nt, 'SUBTRACT', 1.0, unglazed)), op(nt, 'MULTIPLY', unglazed, 0.86))
    nt.links.new(rough, bsdf.inputs['Roughness'])
    setv(bsdf, 'Coat Weight', 0.0)
    setv(bsdf, 'IOR', 1.52)
    # A little light passes into a thick glaze and comes back softened.
    setv(bsdf, 'Subsurface Weight', 0.12 if kind == 'shino' else 0.0)
    setv(bsdf, 'Subsurface Scale', 0.0015)

    # The surface: a glaze is never flat. Slow swells, orange-peel, pinholes; grit where it is bare.
    swell = noise(nt, coords, 16.0, 3.0, 0.5)
    peel = noise(nt, coords, 330.0, 2.0, 0.5)
    normal = bump(nt, swell, 0.20, 0.0010)
    normal = bump(nt, peel, 0.09, 0.00015, normal)
    normal = bump(nt, op(nt, 'MULTIPLY', pinhole, -1.0), 0.35, 0.0002, normal)
    normal = bump(nt, op(nt, 'MULTIPLY', clay_grain, unglazed), 0.6, 0.0003, normal)
    nt.links.new(normal, bsdf.inputs['Normal'])
    return mat


def slate_material():
    mat, nt, bsdf, out = material('slate')
    coords = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    # Slate splits in layers: its grain runs one way, so the pattern is stretched along it.
    layered = nt.nodes.new('ShaderNodeMapping')
    layered.inputs['Scale'].default_value = (1.0, 2.2, 1.0)
    layered.inputs['Rotation'].default_value = (0.0, 0.0, 0.35)
    nt.links.new(coords, layered.inputs['Vector'])
    broad = noise(nt, coords, 1.2, 4.0, 0.5)
    seams = noise(nt, layered.outputs['Vector'], 7.0, 10.0, 0.66)
    grain = noise(nt, coords, 180.0, 4.0, 0.6)
    tone = op(nt, 'ADD', op(nt, 'MULTIPLY', broad, 0.25),
              op(nt, 'ADD', op(nt, 'MULTIPLY', seams, 0.45), op(nt, 'MULTIPLY', grain, 0.30)))
    nt.links.new(ramp(nt, tone, [(0.30, (0.019, 0.020, 0.021)), (0.50, (0.028, 0.029, 0.031)), (0.70, (0.037, 0.038, 0.040))]),
                 bsdf.inputs['Base Color'])
    nt.links.new(band(nt, seams, 0.3, 0.7, 0.55, 0.80, smooth=False), bsdf.inputs['Roughness'])
    normal = bump(nt, seams, 0.30, 0.0025)
    normal = bump(nt, grain, 0.20, 0.0004, normal)
    nt.links.new(normal, bsdf.inputs['Normal'])
    return mat


def linen_material():
    mat, nt, bsdf, out = material('linen')
    coords = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    weave = nt.nodes.new('ShaderNodeTexWave')
    weave.inputs['Scale'].default_value = 900.0
    nt.links.new(coords, weave.inputs['Vector'])
    slub = noise(nt, coords, 60.0, 3.0, 0.6)
    nt.links.new(mix(nt, op(nt, 'MULTIPLY', slub, 0.4), (0.30, 0.25, 0.19), (0.20, 0.16, 0.12)), bsdf.inputs['Base Color'])
    setv(bsdf, 'Roughness', 0.92)
    setv(bsdf, 'Sheen Weight', 0.4)
    nt.links.new(bump(nt, weave.outputs['Fac'], 0.25, 0.0004), bsdf.inputs['Normal'])
    return mat


# ---------------------------------------------------------------- stage: table, light, camera, render
def empty_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def table(size=4.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = 'table'
    obj.data.materials.append(slate_material())
    return obj


def room(scene, strength=0.04):
    world = bpy.data.worlds.new('room')
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    wt = world.node_tree
    wt.nodes.clear()
    background = wt.nodes.new('ShaderNodeBackground')
    wt.links.new(background.outputs['Background'], wt.nodes.new('ShaderNodeOutputWorld').inputs['Surface'])
    root = os.path.dirname(bpy.app.binary_path)
    rooms = glob.glob(os.path.join(root, '*', 'datafiles', 'studiolights', 'world', 'interior.exr'))
    if rooms:
        env = wt.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(rooms[0])
        wt.links.new(env.outputs['Color'], background.inputs['Color'])
        background.inputs['Strength'].default_value = strength
    else:
        background.inputs['Color'].default_value = (0.02, 0.02, 0.022, 1)


def area_light(name, location, size, energy, colour, target=(0, 0, 0.005)):
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = 'RECTANGLE'
    data.size, data.size_y = size
    data.energy = energy
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    aim(obj, target)
    return obj


def window_light(scale=1.0, target=(0, 0, 0.005)):
    """A window at the back left, low and wide; a warm rim from the right; a cool fill from the front.
    `scale` spreads the same light over a larger table without changing how bright it is."""
    def at(x, y, z):
        return (target[0] + x * scale, target[1] + y * scale, z * scale)
    area_light('window', at(-0.80, 0.70, 0.45), (0.90 * scale, 0.45 * scale), 13.0 * scale ** 2, (1.0, 0.93, 0.84), target)
    area_light('rim', at(0.60, 0.70, 0.18), (0.40 * scale, 0.05 * scale), 1.6 * scale ** 2, (1.0, 0.86, 0.70), target)
    area_light('fill', at(0.35, -0.95, 0.75), (1.0 * scale, 1.0 * scale), 0.9 * scale ** 2, (0.82, 0.88, 1.0), target)


def camera(scene, location, target, lens, fstop):
    data = bpy.data.cameras.new('camera')
    data.lens = lens
    cam = bpy.data.objects.new('camera', data)
    scene.collection.objects.link(cam)
    cam.location = location
    aim(cam, target)
    data.dof.use_dof = True
    data.dof.focus_distance = (Vector(target) - cam.location).length
    data.dof.aperture_fstop = fstop
    scene.camera = cam
    return cam


def render_settings(scene, out, samples, width, aspect=2 / 3, image_format=None):
    """`image_format` is taken from the file name when not given: .webp ships (small, keeps transparency),
    .png is for looking at."""
    image_format = image_format or ('WEBP' if out.lower().endswith('.webp') else 'PNG')
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    device = 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == kind
                    scene.cycles.device = 'GPU'
                    device = kind
                    break
            except Exception:
                continue
    except Exception:
        pass
    scene.render.resolution_x = width
    scene.render.resolution_y = int(width * aspect)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = image_format
    scene.render.image_settings.color_mode = 'RGBA'
    if image_format == 'WEBP':
        scene.render.image_settings.quality = 88
    scene.render.filepath = out
    try:
        scene.view_settings.view_transform = 'AgX'
        for look in ('AgX - Medium High Contrast', 'Medium High Contrast'):
            try:
                scene.view_settings.look = look
                break
            except Exception:
                continue
    except Exception:
        pass
    return device


def floor_map(scene, cam, plate):
    """Where a plate's floor lands in the picture: four corners and the centre, in pixels."""
    from bpy_extras.object_utils import world_to_camera_view
    info = plate['plate']
    a = info['length'] / 2 - FLOOR_MARGIN
    b = info['width'] / 2 - FLOOR_MARGIN

    def pixel(x, y):
        v = world_to_camera_view(scene, cam, plate.matrix_world @ Vector((x, y, FLOOR_Z)))
        return [round(v.x * scene.render.resolution_x, 1), round((1 - v.y) * scene.render.resolution_y, 1)]

    return {
        'floor_corners_px': [pixel(-a, -b), pixel(a, -b), pixel(a, b), pixel(-a, b)],
        'floor_centre_px': pixel(0, 0),
        'floor_size_m': [round(2 * a, 4), round(2 * b, 4)],
    }


def camera_record(cam):
    return {'location': [round(c, 5) for c in cam.location], 'rotation_quaternion': [round(c, 6) for c in cam.rotation_quaternion],
            'lens_mm': cam.data.lens, 'sensor_mm': cam.data.sensor_width}
