import { SLAB_OF, STAIRS_OF } from '../res/slabs';
import { RGBA } from './colour';
import { Vector3 } from './vector';
import { TCellShape, TVoxelMeshParams, VoxelMesh } from './voxel_mesh';

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

export namespace SlabUtil {
    /**
     * The block that has the shape, e.g. oak_planks + stairs -> oak_stairs. Undefined if there is none.
     */
    export function variantOf(shape: TCellShape, blockName: string): string | undefined {
        return (shape.kind === 'slab' ? SLAB_OF : STAIRS_OF)[blockName];
    }

    export function stateOf(shape: TCellShape, blockName: string): string | undefined {
        const variant = variantOf(shape, blockName);
        if (variant === undefined) {
            return undefined;
        }
        return shape.kind === 'slab' ?
            `${variant}[type=${shape.type},waterlogged=false]` :
            `${variant}[facing=${shape.facing},half=${shape.half},shape=${shape.shape},waterlogged=false]`;
    }

    /**
     * Turns a mesh that was voxelised at twice the resolution into a normal one. Every 2x2x2 group
     * of voxels becomes one block, the stairs or slab that fills it best, so round surfaces get
     * half-block steps instead of full ones.
     */
    export function fit(fine: VoxelMesh, params: TVoxelMeshParams): VoxelMesh {
        const min = fine.getBounds().min;
        const base = new Vector3(Math.floor(min.x / 2), Math.floor(min.y / 2), Math.floor(min.z / 2));

        type Cell = { position: Vector3, mask: number, colours: RGBA[] };
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
                cell = { position, mask: 0, colours: [] };
                cells.set(key, cell);
            }
            cell.mask |= 1 << (sx + 2 * sz + 4 * sy);
            cell.colours.push(voxel.colour);
        }

        const coarse = new VoxelMesh(params);
        cells.forEach((cell) => {
            // A cell is never dropped (the surface must stay closed), missing a filled part costs more than adding one
            let best = CANDIDATES[0];
            let bestCost = Infinity;
            for (const candidate of CANDIDATES) {
                const cost = popcount(cell.mask & ~candidate.mask) * 3 + popcount(candidate.mask & ~cell.mask);
                if (cost < bestCost) {
                    best = candidate;
                    bestCost = cost;
                }
            }

            const colour: RGBA = { r: 0, g: 0, b: 0, a: 0 };
            cell.colours.forEach((c) => {
                colour.r += c.r / cell.colours.length;
                colour.g += c.g / cell.colours.length;
                colour.b += c.b / cell.colours.length;
                colour.a += c.a / cell.colours.length;
            });

            coarse.addVoxel(cell.position, colour);
            if (best.shape !== undefined) {
                const voxel = coarse.getVoxelAt(cell.position);
                if (voxel !== undefined) {
                    voxel.shape = best.shape;
                }
            }
        });

        return coarse;
    }
}
