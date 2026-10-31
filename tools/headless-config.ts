import { PALETTE_ALL_RELEASE } from '../res/palettes/all';
import { ColourSpace } from '../src/util';
import { Vector3 } from '../src/vector';
import { THeadlessConfig } from './headless';

export const headlessConfig: THeadlessConfig = {
    import: {
        file: new File([], '/Users/lucasdower/ObjToSchematic/res/samples/skull.obj'),
        upAxis: 'y',
        rotation: new Vector3(0, 0, 0),
    },
    voxelise: {
        constraintAxis: 'y',
        voxeliser: 'bvh-ray',
        size: 80,
        useMultisampleColouring: false,
        preserveDetail: false,
        voxelOverlapRule: 'average',
        enableAmbientOcclusion: false, // Only want true if exporting to .obj
        normalBias: 0.0,
        useStairs: false,
    },
    assign: {
        textureAtlas: '26.3', // Must be an atlas name that exists in /resources/atlases
        blockPalette: PALETTE_ALL_RELEASE, // Must be a palette name that exists in /resources/palettes
        dithering: 'ordered',
        ditheringMagnitude: 32,
        colourSpace: ColourSpace.RGB,
        fallable: 'replace-falling',
        resolution: 32,
        calculateLighting: false,
        lightThreshold: 0,
        contextualAveraging: true,
        errorWeight: 0.0,
        minBlockCount: 0,
        maxUniqueBlocks: 0,
    },
    export: {
        exporter: 'litematic', // 'schematic' / 'litematic',
    },
    debug: {
        showLogs: true,
        showWarnings: true,
        showTimings: true,
    },
};
