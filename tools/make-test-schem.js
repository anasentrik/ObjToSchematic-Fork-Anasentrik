/**
 * Writes tools/test-slabs-stairs.schem: every stairs state (facing x half x shape) and every slab type,
 * to check that a paste mod reads the block state properties correctly.
 *
 * Usage: node tools/make-test-schem.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

const DATA_VERSION = 5023; // Minecraft 26.3

const palette = { 'minecraft:air': 0 };
const paletteName = (state) => {
    if (!(state in palette)) {
        palette[state] = Object.keys(palette).length;
    }
    return palette[state];
};

const placed = []; // [x, y, z, state]
const place = (x, y, z, state) => placed.push([x, y, z, state]);

const facings = ['north', 'east', 'south', 'west'];
const halves = ['bottom', 'top'];
const shapes = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
const slabTypes = ['bottom', 'top', 'double'];
const materials = ['oak', 'black_concrete'];

// One block of air between every piece so each one can be told apart
const STRIDE = 2;
let z = 0;
for (const material of materials) {
    for (const half of halves) {
        for (const facing of facings) {
            shapes.forEach((shape, column) => {
                place(column * STRIDE, 1, z, `minecraft:${material}_stairs[facing=${facing},half=${half},shape=${shape},waterlogged=false]`);
            });
            z += STRIDE;
        }
    }
    slabTypes.forEach((type, column) => {
        place(column * STRIDE, 1, z, `minecraft:${material}_slab[type=${type},waterlogged=false]`);
    });
    z += STRIDE;
}

// A floor so the pieces are easy to see
const width = 5 * STRIDE;
const length = z;
for (let x = 0; x < width; ++x) {
    for (let zz = 0; zz < length; ++zz) {
        place(x, 0, zz, 'minecraft:smooth_stone');
    }
}

const height = 2;
const data = new Array(width * height * length).fill(0);
for (const [x, y, zz, state] of placed) {
    data[x + zz * width + y * width * length] = paletteName(state);
}

// VarInt encoding as used by Sponge schematics
const encoded = [];
for (let id of data) {
    while ((id & -128) !== 0) {
        encoded.push(((id & 127) | 128) << 24 >> 24);
        id >>>= 7;
    }
    encoded.push(id << 24 >> 24);
}

const paletteTag = {};
for (const [state, index] of Object.entries(palette)) {
    paletteTag[state] = { type: 'int', value: index };
}

const tag = {
    type: 'compound',
    name: 'Schematic',
    value: {
        Version: { type: 'int', value: 2 },
        DataVersion: { type: 'int', value: DATA_VERSION },
        Width: { type: 'short', value: width },
        Height: { type: 'short', value: height },
        Length: { type: 'short', value: length },
        PaletteMax: { type: 'int', value: Object.keys(palette).length },
        Palette: { type: 'compound', value: paletteTag },
        BlockData: { type: 'byteArray', value: encoded },
    },
};

const out = path.join(__dirname, 'test-slabs-stairs.schem');
fs.writeFileSync(out, zlib.gzipSync(nbt.writeUncompressed(tag, 'big')));
console.log(`${out}: ${width}x${height}x${length}, ${placed.length} blocks, ${Object.keys(palette).length} palette entries`);
