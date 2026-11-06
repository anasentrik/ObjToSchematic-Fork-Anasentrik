import { BUTTON_OF, SLAB_OF, STAIRS_OF } from '../res/slabs';
import { RGBA } from './colour';
import { Vector3 } from './vector';
import { TCellShape, TVoxelMeshParams, VoxelMesh } from './voxel_mesh';
import { VoxeliseParams } from './worker_types';

type TFacing = 'north' | 'east' | 'south' | 'west';

// Horizontal direction as (x, z), z points south
const DIRECTIONS: { [facing in TFacing]: [number, number] } = {
    north: [0, -1],
    east: [1, 0],
    south: [0, 1],
    west: [-1, 0],
};

/**
 * Every block cell is looked at as 2x2x2 small cells, one bit each (bit = x + 2 * z + 4 * y).
 * A shape is the set of small cells it fills: a slab fills one layer, a stair a full layer plus
 * a part of the other one.
 */
type TCandidate = { mask: number, shape?: TCellShape };

const FULL = 0xFF;
const BOTTOM_LAYER = 0x0F;
const TOP_LAYER = 0xF0;

const popcount = (value: number) => {
    let count = 0;
    for (; value !== 0; value >>= 1) {
        count += value & 1;
    }
    return count;
};

function buildCandidates(): TCandidate[] {
    const candidates: TCandidate[] = [
        { mask: FULL },
        { mask: BOTTOM_LAYER, shape: { kind: 'slab', type: 'bottom' } },
        { mask: TOP_LAYER, shape: { kind: 'slab', type: 'top' } },
    ];

    for (const facing of Object.keys(DIRECTIONS) as TFacing[]) {
        const f = DIRECTIONS[facing];
        const r: [number, number] = [-f[1], f[0]]; // Looking along `facing`, to the right

        // The quarter of the cell in direction a * facing + b * right
        const quarter = (a: number, b: number) => {
            const x = a * f[0] + b * r[0];
            const z = a * f[1] + b * r[1];
            return 1 << ((x > 0 ? 1 : 0) + 2 * (z > 0 ? 1 : 0));
        };

        const raised: { [shape: string]: number } = {
            straight: quarter(1, 1) | quarter(1, -1),
            outer_right: quarter(1, 1),
            outer_left: quarter(1, -1),
            inner_right: quarter(1, 1) | quarter(1, -1) | quarter(-1, 1),
            inner_left: quarter(1, 1) | quarter(1, -1) | quarter(-1, -1),
        };

        for (const half of ['bottom', 'top'] as const) {
            for (const shape of Object.keys(raised) as ('straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right')[]) {
                const mask = half === 'bottom' ?
                    BOTTOM_LAYER | (raised[shape] << 4) :
                    TOP_LAYER | raised[shape];
                if (!candidates.some((candidate) => candidate.mask === mask)) {
                    candidates.push({ mask, shape: { kind: 'stairs', facing, half, shape } });
                }
            }
        }
    }

    return candidates;
}

const CANDIDATES = buildCandidates();

/**
 * The six directions out of a cell: the small cells on that side, and the button that sits
 * against a block from that direction, pointing out along it.
 */
const SIDES: { direction: [number, number, number], layer: number, button: TCellShape }[] = [
    { direction: [0, 1, 0], layer: 0xF0, button: { kind: 'button', face: 'floor', facing: 'north' } },
    { direction: [0, -1, 0], layer: 0x0F, button: { kind: 'button', face: 'ceiling', facing: 'north' } },
    { direction: [1, 0, 0], layer: 0xAA, button: { kind: 'button', face: 'wall', facing: 'east' } },
    { direction: [-1, 0, 0], layer: 0x55, button: { kind: 'button', face: 'wall', facing: 'west' } },
    { direction: [0, 0, 1], layer: 0xCC, button: { kind: 'button', face: 'wall', facing: 'south' } },
    { direction: [0, 0, -1], layer: 0x33, button: { kind: 'button', face: 'wall', facing: 'north' } },
];

// RGB distance (0 to 1.7) a detail needs from the block it sits on to become a button
const BUTTON_MIN_CONTRAST = 0.4;
// How alike the rest of a cell must be, so only a lone dot on an even area counts, not texture noise
const BUTTON_MAX_SPREAD = 0.15;

export namespace SlabUtil {
    /**
     * The block that has the shape, e.g. oak_planks + stairs -> oak_stairs. Undefined if there is none.
     */
    export function variantOf(shape: TCellShape, blockName: string): string | undefined {
        switch (shape.kind) {
            case 'slab': return SLAB_OF[blockName];
            case 'stairs': return STAIRS_OF[blockName];
            case 'button': return BUTTON_OF[blockName];
        }
    }

    export function stateOf(shape: TCellShape, blockName: string): string | undefined {
        const variant = variantOf(shape, blockName);
        if (variant === undefined) {
            return undefined;
        }
        switch (shape.kind) {
            case 'slab': return `${variant}[type=${shape.type},waterlogged=false]`;
            case 'stairs': return `${variant}[facing=${shape.facing},half=${shape.half},shape=${shape.shape},waterlogged=false]`;
            case 'button': return `${variant}[face=${shape.face},facing=${shape.facing},powered=false]`;
        }
    }

    /**
     * Turns a mesh that was voxelised at twice the resolution into a normal one. Every 2x2x2 group
     * of voxels becomes one block, the stairs or slab that fills it best, so round surfaces get
     * half-block steps instead of full ones.
     */
    export function fit(fine: VoxelMesh, params: TVoxelMeshParams & Pick<VoxeliseParams.Input, 'useButtons'>): VoxelMesh {
        const min = fine.getBounds().min;
        const base = new Vector3(Math.floor(min.x / 2), Math.floor(min.y / 2), Math.floor(min.z / 2));

        type Cell = { position: Vector3, mask: number, colours: RGBA[], bits: number[] };
        const cells = new Map<string, Cell>();
        for (const voxel of fine.getVoxels()) {
            const rel = Vector3.sub(voxel.position, min);
            const sx = rel.x % 2;
            const sy = rel.y % 2;
            const sz = rel.z % 2;
            const position = new Vector3(
                base.x + Math.floor(rel.x / 2),
                base.y + Math.floor(rel.y / 2),
                base.z + Math.floor(rel.z / 2),
            );
            const key = `${position.x},${position.y},${position.z}`;
            let cell = cells.get(key);
            if (cell === undefined) {
                cell = { position, mask: 0, colours: [], bits: [] };
                cells.set(key, cell);
            }
            const bit = 1 << (sx + 2 * sz + 4 * sy);
            if ((cell.mask & bit) === 0) {
                cell.mask |= bit;
                cell.colours.push(voxel.colour);
                cell.bits.push(bit);
            }
        }

        const average = (colours: RGBA[]) => {
            const colour: RGBA = { r: 0, g: 0, b: 0, a: 0 };
            colours.forEach((c) => {
                colour.r += c.r / colours.length;
                colour.g += c.g / colours.length;
                colour.b += c.b / colours.length;
                colour.a += c.a / colours.length;
            });
            return colour;
        };

        const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
        const distance = (a: RGBA, b: RGBA) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

        // A cell is never dropped (the surface must stay closed), missing a filled part costs more than adding one
        const chosen = new Map<string, TCandidate>();
        cells.forEach((cell, key) => {
            let best = CANDIDATES[0];
            let bestCost = Infinity;
            for (const candidate of CANDIDATES) {
                const cost = popcount(cell.mask & ~candidate.mask) * 3 + popcount(candidate.mask & ~cell.mask);
                if (cost < bestCost) {
                    best = candidate;
                    bestCost = cost;
                }
            }
            chosen.set(key, best);
        });

        const shapes = new Map<string, TCellShape | undefined>();
        const colours = new Map<string, RGBA>();
        cells.forEach((cell, key) => {
            shapes.set(key, chosen.get(key)!.shape);
            colours.set(key, average(cell.colours));
        });
        const added: { position: Vector3, colour: RGBA, shape: TCellShape }[] = [];

        if (params.useButtons) {
            // Is the side of a cell facing `direction` a flat solid face a button can hang on?
            const solidTowards = (key: string, direction: [number, number, number]) => {
                const side = SIDES.find((s) => s.direction.every((v, i) => v === direction[i]))!;
                return (chosen.get(key)!.mask & side.layer) === side.layer;
            };

            cells.forEach((cell, key) => {
                // 1. A tiny bump (one or two small cells against one side) sticking out of a block in a
                //    clearly different colour becomes a button on that block, instead of a whole block
                if (popcount(cell.mask) <= 2) {
                    const colour = colours.get(key)!;
                    for (const side of SIDES) {
                        const towards = side.direction.map((v) => -v) as [number, number, number];
                        const touching = SIDES.find((s) => s.direction.every((v, i) => v === towards[i]))!;
                        if ((cell.mask & ~touching.layer) !== 0) {
                            continue; // Not all of the bump lies against that block
                        }
                        const neighbourKey = keyOf(cell.position.x + towards[0], cell.position.y + towards[1], cell.position.z + towards[2]);
                        if (!cells.has(neighbourKey) || !solidTowards(neighbourKey, side.direction)) {
                            continue;
                        }
                        if (distance(colour, colours.get(neighbourKey)!) >= BUTTON_MIN_CONTRAST) {
                            shapes.set(key, side.button);
                            return;
                        }
                    }
                }

                // 2. A lone dot of a clearly different colour on an even surface (eyes are usually just
                //    texture) becomes a button on the outside of that face, the block keeps the main colour
                if (cell.bits.length < 3) {
                    return;
                }
                let dot = -1;
                let dotContrast = 0;
                cell.colours.forEach((c, i) => {
                    const rest = average(cell.colours.filter((_, j) => j !== i));
                    const contrast = distance(c, rest);
                    if (contrast > dotContrast) {
                        dotContrast = contrast;
                        dot = i;
                    }
                });
                if (dot < 0 || dotContrast < BUTTON_MIN_CONTRAST) {
                    return;
                }
                const rest = cell.colours.filter((_, j) => j !== dot);
                const restColour = average(rest);
                if (rest.some((c) => distance(c, restColour) > BUTTON_MAX_SPREAD)) {
                    return;
                }
                for (const side of SIDES) {
                    if ((cell.bits[dot] & side.layer) === 0 || !solidTowards(key, side.direction)) {
                        continue;
                    }
                    const outside = new Vector3(cell.position.x + side.direction[0], cell.position.y + side.direction[1], cell.position.z + side.direction[2]);
                    const outsideKey = keyOf(outside.x, outside.y, outside.z);
                    if (cells.has(outsideKey) || added.some((b) => b.position.equals(outside))) {
                        continue;
                    }
                    colours.set(key, restColour);
                    added.push({ position: outside, colour: cell.colours[dot], shape: side.button });
                    return;
                }
            });
        }

        const coarse = new VoxelMesh(params);
        const place = (position: Vector3, colour: RGBA, shape: TCellShape | undefined) => {
            coarse.addVoxel(position, colour);
            const voxel = coarse.getVoxelAt(position);
            if (voxel !== undefined && shape !== undefined) {
                voxel.shape = shape;
            }
        };
        cells.forEach((cell, key) => place(cell.position, colours.get(key)!, shapes.get(key)));
        added.forEach((button) => place(button.position, button.colour, button.shape));

        return coarse;
    }
}
