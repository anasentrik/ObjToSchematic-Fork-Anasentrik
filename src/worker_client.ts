import { AppConfig } from './config';
import { SlabUtil } from './slab';
import path from 'path';

import { Atlas } from './atlas';
import { BlockMesh } from './block_mesh';
import { BufferGenerator } from './buffer';
import { EAppEvent, EventManager } from './event';
import { IExporter } from './exporters/base_exporter';
import { ExporterFactory } from './exporters/exporters';
import { ImporterFactor } from './importers/importers';
import { LOC, Localiser } from './localiser';
import { Mesh } from './mesh';
import { PointCloud } from './point_cloud';
import { StatusHandler } from './status';
import { ProgressManager, TTaskHandle } from './progress';
import { ASSERT } from './util/error_util';
import { VoxelMesh } from './voxel_mesh';
import { IVoxeliser } from './voxelisers/base-voxeliser';
import { VoxeliserFactory } from './voxelisers/voxelisers';
import { AssignParams, ExportParams, ImportParams, InitParams, RenderMeshParams, RenderNextBlockMeshChunkParams, RenderNextVoxelMeshChunkParams, SetMaterialsParams, SettingsParams, TFromWorkerMessage, VoxeliseParams } from './worker_types';

export class WorkerClient {
    private static _instance: WorkerClient;
    public static get Get() {
        return this._instance || (this._instance = new this());
    }

    private constructor() {
    }

    private _loadedMesh?: Mesh;
    private _loadedPoints?: PointCloud;
    private _loadedVoxelMesh?: VoxelMesh;
    private _loadedBlockMesh?: BlockMesh;

    /**
     * This function should only be called if the client is using the worker.
     */
    public init(params: InitParams.Input): InitParams.Output {
        EventManager.Get.add(EAppEvent.onTaskStart, (e: any) => {
            const message: TFromWorkerMessage = {
                action: 'Progress',
                payload: {
                    type: 'Started',
                    taskId: e[0],
                },
            };
            postMessage(message);
        });

        EventManager.Get.add(EAppEvent.onTaskProgress, (e: any) => {
            const message: TFromWorkerMessage = {
                action: 'Progress',
                payload: {
                    type: 'Progress',
                    taskId: e[0],
                    percentage: e[1],
                },
            };
            postMessage(message);
        });

        EventManager.Get.add(EAppEvent.onTaskEnd, (e: any) => {
            const message: TFromWorkerMessage = {
                action: 'Progress',
                payload: {
                    type: 'Finished',
                    taskId: e[0],
                },
            };
            postMessage(message);
        });

        // TODO: Async: should await
        Localiser.Get.init();

        return {};
    }

    public async settings(params: SettingsParams.Input): Promise<SettingsParams.Output> {
        await Localiser.Get.changeLanguage(params.language);

        return {};
    }

    public async import(params: ImportParams.Input): Promise<ImportParams.Output> {
        const parsed = path.parse(params.file.name);

        if (PointCloud.isPointCloudFile(params.file.name)) {
            // Gaussian splats are points, not triangles, they skip the mesh entirely
            this._loadedMesh = undefined;
            this._loadedPoints = await PointCloud.load(params.file);
            this._loadedPoints.process(params.upAxis, params.rotation.y, params.rotation.x, params.rotation.z);
            StatusHandler.info(LOC('import.point_count', { count: this._loadedPoints.getCount() }));
            return {
                triangleCount: 0,
                dimensions: this._loadedPoints.getBounds().getDimensions(),
                materials: new Map(),
            };
        }
        this._loadedPoints = undefined;

        const importer = ImporterFactor.GetImporter(parsed.ext === '.obj' ? 'obj' : 'gltf');
        this._loadedMesh = await importer.import(params.file);

        if (params.upAxis !== 'y') {
            this._loadedMesh.convertZUpToYUp(params.upAxis === '-z');
        }
        this._loadedMesh.processMesh(params.rotation.y, params.rotation.x, params.rotation.z);

        return {
            triangleCount: this._loadedMesh.getTriangleCount(),
            dimensions: this._loadedMesh.getBounds().getDimensions(),
            materials: this._loadedMesh.getMaterials(),
        };
    }

    public setMaterials(params: SetMaterialsParams.Input): SetMaterialsParams.Output {
        if (this._loadedPoints !== undefined) {
            return { materials: new Map(), materialsChanged: [] };
        }
        ASSERT(this._loadedMesh !== undefined);

        this._loadedMesh.setMaterials(params.materials);

        return {
            materials: this._loadedMesh.getMaterials(),
            materialsChanged: Array.from(params.materials.keys()), // TODO: Change to actual materials changed
        };
    }

    public renderMesh(params: RenderMeshParams.Input): RenderMeshParams.Output {
        if (this._loadedPoints !== undefined) {
            return { buffers: [], dimensions: this._loadedPoints.getBounds().getDimensions() };
        }
        ASSERT(this._loadedMesh !== undefined);

        return {
            buffers: BufferGenerator.fromMesh(this._loadedMesh),
            dimensions: this._loadedMesh.getBounds().getDimensions(),
        };
    }


    public voxelise(params: VoxeliseParams.Input): VoxeliseParams.Output {
        const points = this._loadedPoints;
        let voxelise: (voxeliseParams: VoxeliseParams.Input) => VoxelMesh;
        if (points !== undefined) {
            voxelise = (voxeliseParams) => {
                const voxelMesh = points.voxelise(voxeliseParams);
                // Hole size is in blocks, the stairs pass voxelises at twice the size
                PointCloud.fillHoles(voxelMesh, Math.round(params.fillHoles * voxeliseParams.size / params.size));
                const dim = voxelMesh.getBounds().getDimensions().add(1);
                StatusHandler.info(LOC('voxelise.voxel_count', { count: voxelMesh.getVoxelCount() }));
                StatusHandler.info(LOC('voxelise.voxel_mesh_dimensions', { x: dim.x, y: dim.y, z: dim.z }));
                return voxelMesh;
            };
        } else {
            const mesh = this._loadedMesh;
            ASSERT(mesh !== undefined);
            const voxeliser: IVoxeliser = VoxeliserFactory.GetVoxeliser(params.voxeliser);
            voxelise = (voxeliseParams) => voxeliser.voxelise(mesh, voxeliseParams);
        }

        if (params.useStairs) {
            // Voxelise at twice the size, every 2x2x2 group of voxels becomes a block, a stairs or a slab
            this._loadedVoxelMesh = SlabUtil.fit(voxelise({ ...params, size: params.size * 2 }), params);
        } else {
            this._loadedVoxelMesh = voxelise(params);
        }
        this._loadedVoxelMesh.calculateNeighbours();

        this._voxelMeshChunkIndex = 0;

        return {
        };
    }

    private _voxelMeshChunkIndex = 0;
    private _voxelMeshProgressHandle?: TTaskHandle;
    public renderChunkedVoxelMesh(params: RenderNextVoxelMeshChunkParams.Input): RenderNextVoxelMeshChunkParams.Output {
        ASSERT(this._loadedVoxelMesh !== undefined);

        const isFirstChunk = this._voxelMeshChunkIndex === 0;
        if (isFirstChunk) {
            this._voxelMeshProgressHandle = ProgressManager.Get.start('VoxelMeshBuffer');
            this._loadedVoxelMesh.setRenderParams(params);
        }

        const buffer = this._loadedVoxelMesh.getChunkedBuffer(this._voxelMeshChunkIndex);
        ++this._voxelMeshChunkIndex;

        if (this._voxelMeshProgressHandle !== undefined) {
            if (buffer.moreVoxelsToBuffer) {
                ProgressManager.Get.progress(this._voxelMeshProgressHandle, buffer.progress);
            } else {
                ProgressManager.Get.end(this._voxelMeshProgressHandle);
                this._voxelMeshProgressHandle = undefined;
            }
        }

        return {
            buffer: buffer,
            dimensions: this._loadedVoxelMesh.getBounds().getDimensions(),
            boundsMin: this._loadedVoxelMesh.getBounds().min,
            boundsMax: this._loadedVoxelMesh.getBounds().max,
            voxelSize: AppConfig.Get.BLOCK_SIZE_UNITS,
            moreVoxelsToBuffer: buffer.moreVoxelsToBuffer,
            isFirstChunk: isFirstChunk,
        };
    }

    public assign(params: AssignParams.Input): AssignParams.Output {
        ASSERT(this._loadedVoxelMesh !== undefined);

        this._loadedBlockMesh = BlockMesh.createFromVoxelMesh(this._loadedVoxelMesh, params);

        this._blockMeshChunkIndex = 0;

        return {
            blockCounts: this._loadedBlockMesh.getBlockCounts(),
        };
    }

    private _blockMeshChunkIndex = 0;
    //private _blockMeshProgressHandle?: TTaskHandle;
    public renderChunkedBlockMesh(params: RenderNextBlockMeshChunkParams.Input): RenderNextBlockMeshChunkParams.Output {
        ASSERT(this._loadedBlockMesh !== undefined);

        const isFirstChunk = this._blockMeshChunkIndex === 0;
        if (isFirstChunk) {
            //this._blockMeshProgressHandle = ProgressManager.Get.start('BlockMeshBuffer');
        }

        const buffer = this._loadedBlockMesh.getChunkedBuffer(this._blockMeshChunkIndex);
        ++this._blockMeshChunkIndex;

        /*
        if (this._blockMeshProgressHandle !== undefined) {
            if (buffer.moreBlocksToBuffer) {
                ProgressManager.Get.progress(this._blockMeshProgressHandle, buffer.progress);
            } else {
                ProgressManager.Get.end(this._blockMeshProgressHandle);
                this._blockMeshProgressHandle = undefined;
            }
        }
        */

        const atlas = Atlas.load(params.textureAtlas);
        ASSERT(atlas !== undefined);

        return {
            buffer: buffer,
            bounds: this._loadedBlockMesh.getVoxelMesh().getBounds(),
            atlasTexturePath: atlas.getAtlasTexturePath(),
            atlasId: params.textureAtlas,
            atlasSize: atlas.getAtlasSize(),
            moreBlocksToBuffer: buffer.moreBlocksToBuffer,
            isFirstChunk: isFirstChunk,
        };
    }

    /*
    public renderBlockMesh(params: RenderBlockMeshParams.Input): RenderBlockMeshParams.Output {
        ASSERT(this._loadedBlockMesh !== undefined);

        const atlas = Atlas.load(params.textureAtlas);
        ASSERT(atlas !== undefined);

        return {
            buffer: this._loadedBlockMesh.getBuffer(),
            dimensions: this._loadedBlockMesh.getVoxelMesh().getBounds().getDimensions(),
            atlasTexturePath: atlas.getAtlasTexturePath(),
            atlasSize: atlas.getAtlasSize(),
        };
    }
    */

    public export(params: ExportParams.Input): ExportParams.Output {
        ASSERT(this._loadedBlockMesh !== undefined);

        const exporter: IExporter = ExporterFactory.GetExporter(params.exporter);
        const files = exporter.export(this._loadedBlockMesh);

        return {
            files: files,
        };
    }
}
