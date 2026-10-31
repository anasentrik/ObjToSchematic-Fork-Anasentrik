"""
Python port of tools/build-atlas.ts (same output format, formatVersion 3).

Usage:
    python tools/build-atlas.py <textures_dir> <models_dir> <output_dir> <ignore_file>

where <textures_dir> is assets/minecraft/textures/block and <models_dir> is
assets/minecraft/models/block from the Minecraft client jar. Writes
<output_dir>/atlas.png and <output_dir>/atlas.atlas.

Requires Pillow and numpy.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

TILE = 16
FACES = ('up', 'down', 'north', 'south', 'east', 'west')

# parent -> function(textures) -> face dict
PARENTS = {
    'minecraft:block/cube_column_horizontal': lambda t: dict(
        up=t['side'], down=t['side'], north=t['end'], south=t['end'], east=t['side'], west=t['side']),
    'minecraft:block/cube_all': lambda t: dict.fromkeys(FACES, t['all']),
    'minecraft:block/cube_column': lambda t: dict(
        up=t['end'], down=t['end'], north=t['side'], south=t['side'], east=t['side'], west=t['side']),
    'minecraft:block/cube_bottom_top': lambda t: dict(
        up=t['top'], down=t['bottom'], north=t['side'], south=t['side'], east=t['side'], west=t['side']),
    'minecraft:block/cube': lambda t: {f: t[f] for f in FACES},
    'minecraft:block/template_single_face': lambda t: dict.fromkeys(FACES, t['texture']),
    'minecraft:block/template_glazed_terracotta': lambda t: dict.fromkeys(FACES, t['pattern']),
    'minecraft:block/leaves': lambda t: dict.fromkeys(FACES, t['all']),
}


def normalise(texture):
    """Models may write 'block/x' or 'minecraft:block/x', the atlas uses the latter."""
    if isinstance(texture, dict):  # 26.x: {"sprite": "...", "force_translucent": true}
        texture = texture.get('sprite')
    if not isinstance(texture, str) or texture.startswith('#'):
        return None
    return texture if ':' in texture else 'minecraft:' + texture


def load_tile(textures_dir, texture):
    name = texture.split('/')[1]
    path = os.path.join(textures_dir, name + '.png')
    if not os.path.isfile(path):
        return None
    image = Image.open(path).convert('RGBA')
    # Animated textures are a vertical strip of frames, use the first one
    return image.crop((0, 0, TILE, TILE))


def average_colour(tile):
    px = np.asarray(tile, dtype=np.float64) / 255.0
    alpha = px[..., 3]
    weight = alpha.sum()
    if weight == 0:
        return dict(r=0.0, g=0.0, b=0.0, a=0.0), 0.0
    rgb = px[..., :3] * alpha[..., None]
    avg = rgb.sum(axis=(0, 1)) / weight
    sq = ((rgb - avg) ** 2).sum()
    std = math.sqrt(sq / weight)
    return dict(r=avg[0], g=avg[1], b=avg[2], a=weight / (TILE * TILE)), std


def main():
    textures_dir, models_dir, output_dir, ignore_path = sys.argv[1:5]
    ignore = set(open(ignore_path, encoding='utf8').read().splitlines())

    models = []
    skipped = []
    for file_name in sorted(os.listdir(models_dir)):
        if file_name in ignore or not file_name.endswith('.json'):
            continue
        model = json.load(open(os.path.join(models_dir, file_name), encoding='utf8'))
        build = PARENTS.get(model.get('parent'))
        if build is None:
            continue
        try:
            faces = {k: normalise(v) for k, v in build(model.get('textures', {})).items()}
        except KeyError:
            skipped.append(file_name)
            continue
        if any(v is None for v in faces.values()):
            skipped.append(file_name)
            continue
        models.append((file_name, faces))

    tiles = {}
    for file_name, faces in list(models):
        for texture in faces.values():
            if texture not in tiles:
                tiles[texture] = load_tile(textures_dir, texture)
        if any(tiles[t] is None for t in faces.values()):
            skipped.append(file_name)
            models.remove((file_name, faces))

    names = sorted(t for t in tiles if tiles[t] is not None and any(t in f.values() for _, f in models))
    atlas_size = math.ceil(math.sqrt(len(names)))

    atlas = Image.new('RGBA', (atlas_size * TILE * 3, atlas_size * TILE * 3), (255, 255, 255, 0))
    textures = {}
    for index, name in enumerate(names):
        column, row = index % atlas_size, index // atlas_size
        colour, std = average_colour(tiles[name])
        textures[name] = dict(atlasColumn=column, atlasRow=row, colour=colour, std=std)
        for i in range(3):
            for j in range(3):
                atlas.alpha_composite(tiles[name], (column * TILE * 3 + TILE * i, row * TILE * 3 + TILE * j))

    blocks = []
    for file_name, faces in models:
        colours = [textures[faces[f]]['colour'] for f in FACES]
        blocks.append(dict(
            name='minecraft:' + file_name.split('.')[0],
            faces={f: faces[f] for f in FACES},
            colour={k: sum(c[k] for c in colours) / len(colours) for k in 'rgba'},
        ))

    os.makedirs(output_dir, exist_ok=True)
    atlas.save(os.path.join(output_dir, 'atlas.png'))
    with open(os.path.join(output_dir, 'atlas.atlas'), 'w', encoding='utf8') as out:
        json.dump(dict(formatVersion=3, atlasSize=atlas_size, blocks=blocks, textures=textures), out, indent=4)

    print(f'{len(blocks)} blocks, {len(names)} textures, atlas {atlas_size}x{atlas_size}')
    if skipped:
        print('skipped (unresolved textures):', ', '.join(sorted(set(skipped))))


if __name__ == '__main__':
    main()
