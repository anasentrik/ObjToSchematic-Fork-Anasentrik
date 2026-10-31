import { Atlas, TAtlasBlock } from './atlas';
import { AtlasPalette, EFaceVisibility, TBlockCollection } from './block_assigner';
import { BlockInfo } from './block_atlas';
import { ChunkedBufferGenerator, TBlockMeshBufferDescription } from './buffer';
import { RGBA_255, RGBAUtil } from './colour';
import { AppRuntimeConstants } from './constants';
import { Ditherer } from './dither';
import { BlockMeshLighting } from './lighting';
import { LOC } from './localiser';
import { Palette } from './palette';
import { ProgressManager } from './progress';
import { StatusHandler } from './status';
import { ColourSpace, TOptional } from './util';
import { AppError, ASSERT } from './util/error_util';
import { LOGF } from './util/log_util';
import { SlabUtil } from './slab';
import { Vector3 } from './vector';
import { Voxel, VoxelMesh } from './voxel_mesh';
import { AssignParams } from './worker_types';

interface Block {
    voxel: Voxel;
    blockInfo: BlockInfo;
}

interface GrassLikeBlock {
    hash: number;
    voxelColour: RGBA_255;
    errWeight: number;
    faceVisibility: EFaceVisibility;
}

export type FallableBehaviour = 'replace-falling' | 'replace-fallable' | 'place-string' | 'do-nothing';

export interface BlockMeshParams {
    textureAtlas: Atlas,
    blockPalette: Palette,
    colourSpace: ColourSpace,
    fallable: FallableBehaviour,
}

export class BlockMesh {
    private _blocksUsed: Set<string>;
    private _blocks: Map<number, Block>;
    //private _blocks: Block[];
    private _voxelMesh: VoxelMesh;
    private _atlas: Atlas;
    private _lighting: BlockMeshLighting;

    public static createFromVoxelMesh(voxelMesh: VoxelMesh, blockMeshParams: AssignParams.Input) {
        const blockMesh = new BlockMesh(voxelMesh);
        blockMesh._assignBlocks(blockMeshParams);

        //blockMesh._calculateLighting(blockMeshParams.lightThreshold);
        if (blockMeshParams.calculateLighting) {
            blockMesh._lighting.init();
            blockMesh._lighting.addSunLightValues();
            blockMesh._lighting.addEmissiveBlocks();
            blockMesh._lighting.addLightToDarkness(blockMeshParams.lightThreshold);
            blockMesh._lighting.dumpInfo();
        }

        return blockMesh;
    }

    private constructor(voxelMesh: VoxelMesh) {
        this._blocksUsed = new Set();
        this._blocks = new Map();
        this._voxelMesh = voxelMesh;
        this._atlas = Atlas.getVanillaAtlas()!;
        this._lighting = new BlockMeshLighting(this);
    }

    /**
     * Before we turn a voxel into a block we have the opportunity to alter the voxel's colour.
     * This is where the colour accuracy bands colours together and where dithering is calculated.
     */
    private _getFinalVoxelColour(voxel: Voxel, blockMeshParams: AssignParams.Input) {
        const voxelColour = RGBAUtil.copy(voxel.colour);

        const binnedColour = RGBAUtil.bin(voxelColour, blockMeshParams.resolution);

        const ditheredColour: RGBA_255 = RGBAUtil.copy255(binnedColour);
        switch (blockMeshParams.dithering) {
            case 'off': {
                break;
            }
            case 'random': {
                Ditherer.ditherRandom(ditheredColour, blockMeshParams.ditheringMagnitude);
                break;
            }
            case 'ordered': {
                Ditherer.ditherOrdered(ditheredColour, voxel.position, blockMeshParams.ditheringMagnitude);
                break;
            }
        }

        return ditheredColour;
    }

    private _assignBlocks(blockMeshParams: AssignParams.Input) {
        const atlas = Atlas.load(blockMeshParams.textureAtlas);
        ASSERT(atlas !== undefined, 'Could not load atlas');
        this._atlas = atlas;

        const palette = Palette.create();
        palette.add(blockMeshParams.blockPalette);
        ASSERT(palette !== undefined, 'Could not load palette');

        const atlasPalette = new AtlasPalette(atlas, palette);
        const allBlockCollection = atlasPalette.createBlockCollection([]);
        const nonFallableBlockCollection = atlasPalette.createBlockCollection(Array.from(AppRuntimeConstants.Get.FALLABLE_BLOCKS));
        const grassLikeBlocksBuffer: GrassLikeBlock[] = [];

        let countFalling = 0;
        const taskHandle = ProgressManager.Get.start('Assigning');
        const voxels = this._voxelMesh.getVoxels();
        for (let voxelIndex = 0; voxelIndex < voxels.length; ++voxelIndex) {
            ProgressManager.Get.progress(taskHandle, voxelIndex / voxels.length);

            // Convert the voxel into a block
            const voxel = voxels[voxelIndex];
            const voxelColour = this._getFinalVoxelColour(voxel, blockMeshParams);
            const faceVisibility = blockMeshParams.contextualAveraging ?
                this._voxelMesh.getFaceVisibility(voxel.position) :
                VoxelMesh.getFullFaceVisibility();
            let block = atlasPalette.getBlock(voxelColour, allBlockCollection, faceVisibility, blockMeshParams.errorWeight, blockMeshParams.colourSpace);

            // Check that this block meets the fallable behaviour, we may need
            // to choose a different block if the current one doesn't meet the requirements
            const isBlockFallable = AppRuntimeConstants.Get.FALLABLE_BLOCKS.has(block.name);
            const isBlockSupported = this._voxelMesh.isVoxelAt(Vector3.add(voxel.position, new Vector3(0, -1, 0)));

            if (isBlockFallable && !isBlockSupported) {
                ++countFalling;
            }

            const shouldReplaceBlock =
                (blockMeshParams.fallable === 'replace-fallable' && isBlockFallable) ||
                (blockMeshParams.fallable === 'replace-falling' && isBlockFallable && !isBlockSupported);

            if (shouldReplaceBlock) {
                block = atlasPalette.getBlock(voxelColour, nonFallableBlockCollection, faceVisibility, blockMeshParams.errorWeight, blockMeshParams.colourSpace);
            }

            if (AppRuntimeConstants.Get.GRASS_LIKE_BLOCKS.has(block.name)) {
                grassLikeBlocksBuffer.push({
                    hash: voxel.position.hash(),
                    voxelColour: voxelColour,
                    errWeight: blockMeshParams.errorWeight,
                    faceVisibility: faceVisibility,
                });
            }

            this._blocks.set(voxel.position.hash(), {
                voxel: voxel,
                blockInfo: block,
            });
            this._blocksUsed.add(block.name);
        }

        if (grassLikeBlocksBuffer.length > 0) {
            const nonGrassLikeBlockCollection = atlasPalette.createBlockCollection(Array.from(AppRuntimeConstants.Get.GRASS_LIKE_BLOCKS));
            for (let index=0; index < grassLikeBlocksBuffer.length; index++) {
                ProgressManager.Get.progress(taskHandle, index / grassLikeBlocksBuffer.length);
                const examined = grassLikeBlocksBuffer[index];
                const examinedBlock = this._blocks.get(examined.hash);
                ASSERT(examinedBlock, 'Missing examined block');

                const topBlockPosition = Vector3.add(examinedBlock.voxel.position, new Vector3(0, 1, 0));
                const topBlock = this._blocks.get(topBlockPosition.hash());
                if (topBlock !== undefined) {
                    if (!AppRuntimeConstants.Get.TRANSPARENT_BLOCKS.has(topBlock.blockInfo.name)) {
                        const block = atlasPalette.getBlock(examined.voxelColour, nonGrassLikeBlockCollection, examined.faceVisibility, examined.errWeight, blockMeshParams.colourSpace);
                        examinedBlock.blockInfo = block;
                        this._blocks.set(examined.hash, examinedBlock);
                        this._blocksUsed.add(block.name);
                    }
                }
            }
        }
        ProgressManager.Get.end(taskHandle);

        this._reduceBlockVariety(blockMeshParams, atlasPalette, allBlockCollection);
        this._enforceShapeBlocks(blockMeshParams, atlasPalette, allBlockCollection);

        if (blockMeshParams.fallable === 'do-nothing' && countFalling > 0) {
            StatusHandler.warning(LOC('assign.falling_blocks', { count: countFalling }));
        }
    }

    public getBlockCounts(): { name: string, count: number }[] {
        const counts = new Map<string, number>();
        this._blocks.forEach((block) => {
            counts.set(block.blockInfo.name, (counts.get(block.blockInfo.name) ?? 0) + 1);
        });
        return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    }

    /**
     * Applies 'Min Block Count' and 'Unique Blocks': rarely used blocks are
     * dropped and their voxels are re-matched against the remaining blocks.
     * Done in a single pass, so a kept block can end up below the minimum
     * after reassignment, that's accepted to keep this predictable and fast.
     */
    private _reduceBlockVariety(params: AssignParams.Input, atlasPalette: AtlasPalette, allBlocks: TBlockCollection) {
        if (params.minBlockCount <= 0 && params.maxUniqueBlocks <= 0) {
            return;
        }

        const sorted = this.getBlockCounts();
        let kept = sorted;
        if (params.minBlockCount > 0) {
            kept = kept.filter((entry) => entry.count >= params.minBlockCount);
        }
        if (params.maxUniqueBlocks > 0) {
            kept = kept.slice(0, params.maxUniqueBlocks);
        }
        if (kept.length === 0) {
            kept = sorted.slice(0, 1); // Always keep the most used block
        }
        if (kept.length === sorted.length) {
            return;
        }

        const keptNames = new Set(kept.map((entry) => entry.name));
        const exclude = Array.from(allBlocks.blocks.keys()).filter((name) => !keptNames.has(name));
        const keptCollection = atlasPalette.createBlockCollection(exclude);

        // Fallable blocks must still obey the chosen falling behaviour
        const fallable = AppRuntimeConstants.Get.FALLABLE_BLOCKS;
        const keptNonFallableNames = kept.map((entry) => entry.name).filter((name) => !fallable.has(name));
        const keptNonFallable = keptNonFallableNames.length > 0 ?
            atlasPalette.createBlockCollection(Array.from(allBlocks.blocks.keys()).filter((name) => !keptNames.has(name) || fallable.has(name))) :
            keptCollection;

        this._blocks.forEach((block) => {
            if (keptNames.has(block.blockInfo.name)) {
                return;
            }
            const voxel = block.voxel;
            const colour = this._getFinalVoxelColour(voxel, params);
            const faceVisibility = params.contextualAveraging ?
                this._voxelMesh.getFaceVisibility(voxel.position) :
                VoxelMesh.getFullFaceVisibility();
            let replacement = atlasPalette.getBlock(colour, keptCollection, faceVisibility, params.errorWeight, params.colourSpace);
            const isSupported = this._voxelMesh.isVoxelAt(Vector3.add(voxel.position, new Vector3(0, -1, 0)));
            const mustAvoidFalling = fallable.has(replacement.name) && (
                params.fallable === 'replace-fallable' ||
                (params.fallable === 'replace-falling' && !isSupported)
            );
            if (mustAvoidFalling) {
                replacement = atlasPalette.getBlock(colour, keptNonFallable, faceVisibility, params.errorWeight, params.colourSpace);
            }
            block.blockInfo = replacement;
        });

        this._blocksUsed = new Set(this.getBlockCounts().map((entry) => entry.name));
    }

    /**
     * A stairs or slab cell can only be a block that has that shape, so other blocks are swapped
     * for the closest colour among the palette blocks that do.
     */
    private _enforceShapeBlocks(params: AssignParams.Input, atlasPalette: AtlasPalette, allBlocks: TBlockCollection) {
        const needsSwap = (block: Block) => block.voxel.shape !== undefined && SlabUtil.variantOf(block.voxel.shape, block.blockInfo.name) === undefined;
        const blocks = Array.from(this._blocks.values());
        if (!blocks.some(needsSwap)) {
            return;
        }

        // Swap per kind of shape, a block can have slabs but no stairs
        for (const kind of ['stairs', 'slab'] as const) {
            const wanted = blocks.filter((block) => needsSwap(block) && block.voxel.shape?.kind === kind);
            if (wanted.length === 0) {
                continue;
            }
            const probe = kind === 'slab' ? { kind, type: 'bottom' as const } : { kind, facing: 'north' as const, half: 'bottom' as const, shape: 'straight' as const };
            const exclude = Array.from(allBlocks.blocks.keys()).filter((name) => SlabUtil.variantOf(probe, name) === undefined);
            if (exclude.length === allBlocks.blocks.size) {
                continue; // Nothing in the palette has this shape, these export as full blocks
            }
            const collection = atlasPalette.createBlockCollection(exclude);
            wanted.forEach((block) => {
                const colour = this._getFinalVoxelColour(block.voxel, params);
                block.blockInfo = atlasPalette.getBlock(colour, collection, VoxelMesh.getFullFaceVisibility(), params.errorWeight, params.colourSpace);
            });
        }
        this._blocksUsed = new Set(this.getBlockCounts().map((entry) => entry.name));
    }

    // Face order: ['north', 'south', 'up', 'down', 'east', 'west']
    public getBlockLighting(position: Vector3) {
        // TODO: Shouldn't only use sunlight value, take max of either
        return [
            this._lighting.getMaxLightLevel(new Vector3(1, 0, 0).add(position)),
            this._lighting.getMaxLightLevel(new Vector3(-1, 0, 0).add(position)),
            this._lighting.getMaxLightLevel(new Vector3(0, 1, 0).add(position)),
            this._lighting.getMaxLightLevel(new Vector3(0, -1, 0).add(position)),
            this._lighting.getMaxLightLevel(new Vector3(0, 0, 1).add(position)),
            this._lighting.getMaxLightLevel(new Vector3(0, 0, -1).add(position)),
        ];
    }

    public setEmissiveBlock(pos: Vector3): boolean {
        const voxel = this._voxelMesh.getVoxelAt(pos);
        ASSERT(voxel !== undefined, 'Missing voxel');
        const minError = Infinity;
        let bestBlock: TAtlasBlock | undefined;
        AppRuntimeConstants.Get.EMISSIVE_BLOCKS.forEach((emissiveBlockName) => {
            const emissiveBlockData = this._atlas.getBlocks().get(emissiveBlockName);
            if (emissiveBlockData) {
                const error = RGBAUtil.squaredDistance(emissiveBlockData.colour, voxel.colour);
                if (error < minError) {
                    bestBlock = emissiveBlockData;
                }
            }
        });

        if (bestBlock !== undefined) {
            const blockIndex = 0; //this._voxelMesh.getVoxelIndex(pos);
            ASSERT(blockIndex !== undefined, 'Setting emissive block of block that doesn\'t exist');

            const block = this._blocks.get(pos.hash());
            ASSERT(block !== undefined);

            block.blockInfo = bestBlock;
            return true;
        }

        throw new AppError(LOC('assign.block_palette_missing_light_blocks'));
    }

    public getBlockAt(pos: Vector3): TOptional<Block> {
        return this._blocks.get(pos.hash());
    }

    public getBlocks(): Block[] {
        return Array.from(this._blocks.values());
    }

    public getBlockPalette() {
        return Array.from(this._blocksUsed);
    }

    public getVoxelMesh() {
        ASSERT(this._voxelMesh !== undefined, 'Block mesh has no voxel mesh');
        return this._voxelMesh;
    }

    public getAtlas() {
        return this._atlas;
    }

    public isEmissiveBlock(block: Block) {
        return AppRuntimeConstants.Get.EMISSIVE_BLOCKS.has(block.blockInfo.name);
    }

    public isTransparentBlock(block: Block) {
        return AppRuntimeConstants.Get.TRANSPARENT_BLOCKS.has(block.blockInfo.name);
    }

    /*
    private _buffer?: TBlockMeshBufferDescription;
    public getBuffer(): TBlockMeshBufferDescription {
        //ASSERT(this._renderParams, 'Called BlockMesh.getBuffer() without setting render params');
        if (this._buffer === undefined) {
            this._buffer = BufferGenerator.fromBlockMesh(this);
            //this._recreateBuffer = false;
        }
        return this._buffer;
    }
    */

    private _bufferChunks: Array<TBlockMeshBufferDescription & { moreBlocksToBuffer: boolean, progress: number }> = [];
    public getChunkedBuffer(chunkIndex: number): TBlockMeshBufferDescription & { moreBlocksToBuffer: boolean, progress: number } {
        if (this._bufferChunks[chunkIndex] === undefined) {
            LOGF(`[BlockMesh]: getChunkedBuffer: ci: ${chunkIndex} not cached`);
            this._bufferChunks[chunkIndex] = ChunkedBufferGenerator.fromBlockMesh(this, chunkIndex);
        } else {
            LOGF(`[BlockMesh]: getChunkedBuffer: ci: ${chunkIndex} not cached`);
        }
        return this._bufferChunks[chunkIndex];
    }

    public getAllChunkedBuffers() {
        return this._bufferChunks;
    }
}
