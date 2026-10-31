import { NBT, TagType } from 'prismarine-nbt';

import { BlockMesh } from '../block_mesh';
import { SlabUtil } from '../slab';
import { AppConstants } from '../constants';
import { AppUtil } from '../util';
import { LOG } from '../util/log_util';
import { MathUtil } from '../util/math_util';
import { saveNBT } from '../util/nbt_util';
import { Vector3 } from '../vector';
import { TCellShape } from '../voxel_mesh';
import { IExporter, TStructureExport } from './base_exporter';

export class SchemExporter extends IExporter {
    private static SCHEMA_VERSION = 2;

    public override getFormatFilter() {
        return {
            name: 'Sponge Schematic',
            extension: 'schem',
        };
    }

    public override export(blockMesh: BlockMesh): TStructureExport {
        const bounds = blockMesh.getVoxelMesh().getBounds();
        const sizeVector = bounds.getDimensions().add(1);

        // https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md#paletteObject
        // const blockMapping: BlockMapping = {};
        const blockMapping: {[name: string]: { type: TagType, value: any }} = {
            'minecraft:air': { type: TagType.Int, value: 0 },
        };

        // Stairs and slabs are written with their block state, e.g. minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]
        const stateOf = (block: { voxel: { shape?: TCellShape }, blockInfo: { name: string } }) => {
            const name = AppUtil.Text.namespaceBlock(block.blockInfo.name);
            return (block.voxel.shape !== undefined ? SlabUtil.stateOf(block.voxel.shape, name) : undefined) ?? name;
        };

        let blockIndex = 1;
        for (const block of blockMesh.getBlocks()) {
            const state = stateOf(block);
            if (!(state in blockMapping)) {
                blockMapping[state] = { type: TagType.Int, value: blockIndex };
                ++blockIndex;
            }
        }
        LOG(blockMapping);

        // const paletteObject = SchemExporter._createBlockStatePalette(blockMapping);
        const blockData = new Array<number>(sizeVector.x * sizeVector.y * sizeVector.z).fill(0);
        for (const block of blockMesh.getBlocks()) {
            const indexVector = Vector3.sub(block.voxel.position, bounds.min);
            const bufferIndex = SchemExporter._getBufferIndex(sizeVector, indexVector);
            blockData[bufferIndex] = blockMapping[stateOf(block)].value;
        }

        const blockEncoding: number[] = [];
        for (let i = 0; i < blockData.length; ++i) {
            let id = blockData[i];

            while ((id & -128) != 0) {
                blockEncoding.push(id & 127 | 128);
                id >>>= 7;
            }
            blockEncoding.push(id);
        }

        for (let i = 0; i < blockEncoding.length; ++i) {
            blockEncoding[i] = MathUtil.int8(blockEncoding[i]);
        }

        const nbt: NBT = {
            type: TagType.Compound,
            name: 'Schematic',
            value: {
                Version: { type: TagType.Int, value: SchemExporter.SCHEMA_VERSION },
                DataVersion: { type: TagType.Int, value: AppConstants.DATA_VERSION },
                Width: { type: TagType.Short, value: sizeVector.x },
                Height: { type: TagType.Short, value: sizeVector.y },
                Length: { type: TagType.Short, value: sizeVector.z },
                PaletteMax: { type: TagType.Int, value: blockIndex },
                Palette: { type: TagType.Compound, value: blockMapping },
                BlockData: { type: TagType.ByteArray, value: blockEncoding },
            },
        };

        return { type: 'single', extension: '.schem', content: saveNBT(nbt) };
    }

    private static _getBufferIndex(dimensions: Vector3, vec: Vector3) {
        return vec.x + (vec.z * dimensions.x) + (vec.y * dimensions.x * dimensions.z);
    }
}
