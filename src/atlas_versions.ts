import ATLAS_1_21_7 from '../res/atlases/1.21.7.atlas';
import ATLAS_26_3 from '../res/atlases/26.3.atlas';

/**
 * The Minecraft versions we have a block atlas for. To add a new version: build its atlas with
 * tools/build-atlas.py, put it in res/atlases/<id>.atlas and .png, then add it here, in the
 * ATLAS_TEXTURES table of the renderer and in the dropdown in ui/layout.ts.
 */
export const ATLAS_VERSIONS: { [id: string]: { atlas: string, dataVersion: number } } = {
    '26.3': { atlas: ATLAS_26_3, dataVersion: 5023 },
    '1.21.7': { atlas: ATLAS_1_21_7, dataVersion: 4438 },
};

export const DEFAULT_ATLAS_VERSION = '26.3';
