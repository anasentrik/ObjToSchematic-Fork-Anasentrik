import { AppRuntimeConstants } from './constants';

/**
 * Groups of blocks that are usually unwanted in a build and can be left out of the palette automatically.
 */
export namespace BlockFilters {
    const FALLING = /(^|:)(suspicious_)?(red_)?(sand|gravel)$|_concrete_powder$|(^|:)(anvil|chipped_anvil|damaged_anvil|dragon_egg)$/;
    const GLASS = /glass$/;
    const LIQUID = /(^|:)(water|lava|flowing_water|flowing_lava)$/;

    export function isFalling(block: string) {
        return AppRuntimeConstants.Get.FALLABLE_BLOCKS.has(block) || FALLING.test(block);
    }

    export function isGlass(block: string) {
        return GLASS.test(block);
    }

    export function isLiquid(block: string) {
        return LIQUID.test(block);
    }
}
