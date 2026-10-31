import path from 'path';

import { ATLAS_VERSIONS, DEFAULT_ATLAS_VERSION } from './atlas_versions';
import { RGBA } from './colour';
import { AppTypes, AppUtil, TOptional, UV } from './util';
import { ASSERT } from './util/error_util';
import { AppPaths } from './util/path_util';

export type TAtlasBlockFace = {
    name: string,
    texcoord: UV,
    colour: RGBA,
    std: number,
}

export type TAtlasBlock = {
    name: string;
    colour: RGBA;
    faces: {
        up: TAtlasBlockFace,
        down: TAtlasBlockFace,
        north: TAtlasBlockFace,
        east: TAtlasBlockFace,
        south: TAtlasBlockFace,
        west: TAtlasBlockFace,
    };
}

/**
 * Atlases, unlike palettes, are not currently designed to be user-facing or
 * programmatically created. This class simply facilitates loading .atlas
 * files.
 */
export class Atlas {
    public static ATLAS_NAME_REGEX: RegExp = /^[a-zA-Z0-9.\-]+$/;

    private _blocks: Map<AppTypes.TNamespacedBlockName, TAtlasBlock>;
    private _atlasSize: number;
    private _atlasName: string;
    private _dataVersion = 0;

    private constructor(atlasName: string) {
        this._blocks = new Map<AppTypes.TNamespacedBlockName, TAtlasBlock>();
        this._atlasSize = 0;
        this._atlasName = atlasName;
    }

    public getBlocks() {
        return this._blocks;
    }

    public static load(atlasName: string): TOptional<Atlas> {
        const version = ATLAS_VERSIONS[atlasName];
        ASSERT(version !== undefined, `Unknown block atlas '${atlasName}'`);

        const atlas = new Atlas(atlasName);
        atlas._dataVersion = version.dataVersion;

        const atlasJSON = JSON.parse(version.atlas);

        ASSERT(atlasJSON.formatVersion === 3, `The '${atlasName}' texture atlas uses an outdated format and needs to be recreated`);

        const atlasData = atlasJSON;
        atlas._atlasSize = atlasData.atlasSize;

        const getTextureUV = (name: string) => {
            const tex = atlasData.textures[name];
            return new UV(
                (3 * tex.atlasColumn + 1) / (atlas._atlasSize * 3),
                (3 * tex.atlasRow + 1) / (atlas._atlasSize * 3),
            );
        };

        for (const block of atlasData.blocks) {
            ASSERT(AppUtil.Text.isNamespacedBlock(block.name), 'Atlas block not namespaced');

            const atlasBlock: TAtlasBlock = {
                name: block.name,
                colour: block.colour,
                faces: {
                    up: {
                        name: block.faces.up,
                        texcoord: getTextureUV(block.faces.up),
                        std: atlasData.textures[block.faces.up].std,
                        colour: atlasData.textures[block.faces.up].colour,
                    },
                    down: {
                        name: block.faces.down,
                        texcoord: getTextureUV(block.faces.down),
                        std: atlasData.textures[block.faces.down].std,
                        colour: atlasData.textures[block.faces.down].colour,
                    },
                    north: {
                        name: block.faces.north,
                        texcoord: getTextureUV(block.faces.north),
                        std: atlasData.textures[block.faces.north].std,
                        colour: atlasData.textures[block.faces.north].colour,
                    },
                    east: {
                        name: block.faces.east,
                        texcoord: getTextureUV(block.faces.east),
                        std: atlasData.textures[block.faces.east].std,
                        colour: atlasData.textures[block.faces.east].colour,
                    },
                    south: {
                        name: block.faces.south,
                        texcoord: getTextureUV(block.faces.south),
                        std: atlasData.textures[block.faces.south].std,
                        colour: atlasData.textures[block.faces.south].colour,
                    },
                    west: {
                        name: block.faces.west,
                        texcoord: getTextureUV(block.faces.west),
                        std: atlasData.textures[block.faces.west].std,
                        colour: atlasData.textures[block.faces.west].colour,
                    },
                },
            };

            atlas._blocks.set(block.name, atlasBlock);
        }

        return atlas;
    }

    /**
     * The Minecraft DataVersion of the version this atlas was made from, written into exported files.
     */
    public getDataVersion(): number {
        return this._dataVersion;
    }

    public getAtlasSize(): number {
        return this._atlasSize;
    }

    public getAtlasTexturePath() {
        return path.join(AppPaths.Get.atlases, `./${this._atlasName}.png`);
    }

    /*
    public getBlocks(): TAtlasBlock[] {
        return Array.from(this._blocks.values());
    }
    */

    public hasBlock(blockName: AppTypes.TNamespacedBlockName): boolean {
        return this._blocks.has(blockName);
    }

    public static getVanillaAtlas(): TOptional<Atlas> {
        return Atlas.load(DEFAULT_ATLAS_VERSION);
    }

    private static _isValidAtlasName(atlasName: string): boolean {
        return atlasName.length > 0 && Atlas.ATLAS_NAME_REGEX.test(atlasName);
    }

    private static _getAtlasPath(atlasName: string): string {
        return path.join(AppPaths.Get.atlases, `./${atlasName}.atlas`);
    }
}
