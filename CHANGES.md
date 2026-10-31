# Changes from the original ObjToSchematic 1.0

This fork is a personal project, built for my own standalone app. It focuses on **GLB input and `.schem` output**.
Everything below was added on top of [LucasDower/ObjToSchematic](https://github.com/LucasDower/ObjToSchematic) 1.0.
Other formats (`.litematic`, `.nbt`, `.schematic`, the JSON exporters) are not tested here and may be broken.

## Minecraft 26.3

- Block atlas and texture atlas regenerated from the 26.3 client jar (417 blocks, 435 textures).
- **Block atlas dropdown**: 26.3 (default) or 1.21.7 (the original atlas). Each version writes its own DataVersion into exported files (5023 and 4438). To add a version, see `src/atlas_versions.ts`.
- Block palette regenerated: 352 blocks, including the new cinnabar, sulfur, resin, poplar, pale oak and copper variants.
- `DATA_VERSION` is `5023` and the version shown in the UI is `26.3`.
- `tools/build-atlas.py`, a Python port of `build-atlas.ts` that understands the new `{"sprite": ...}` texture entries in 26.x models.
- `tools/models-ignore-list.txt` extended with the internal `test_block_*` models.
- `res/slabs.ts`, generated from the jar: which full block has which slab (96) and stairs (93).

## Colour matching and voxelising

- **Colour space**: Oklab (default) or RGB, used when matching voxel colours to blocks.
- **Blend mode** (voxel overlap): Average or Replace.
- **Normal bias** slider for the normal-corrected raycast voxeliser.
- **Min block count** and **Unique blocks**: rarely used blocks are replaced by the closest remaining block.
- **Block breakdown**: a list of every block used with its count, and a button to remove a block from the palette and re-assign.
- **Preserve detail** (on by default): a triangle that the rays slipped past, because it is very small or thin, still gets a voxel at its centre.
- Renamed options to match the v2 web UI (Triplane Raycast, Texture area sampling, Replace unsupported / Replace all / Keep).

## Stairs and slabs (`.schem` only, off by default)

- Option "Stairs and slabs": the model is voxelised at twice the size, then every 2x2x2 group of voxels becomes the best fitting block, slab or stairs (4 facings x 2 halves x 5 shapes).
- Blocks without a slab or stairs variant are swapped for the closest colour that has one.
- Written to `.schem` with their block state, for example `minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]`.
- The viewer draws slabs at half height and stairs as full cubes.
- `tools/make-test-schem.js` writes `tools/test-slabs-stairs.schem` with every stairs and slab state, for checking a paste tool.

## Menu and layout

- A single wizard-style sidebar: the sections (Import, Materials, Voxel, Block, Export) open one after another, and the one in use stays open.
- A **Generate blocks** button that voxelises and assigns in one go.
- Meta blue theme instead of red, with red kept for OFF states.
- **Block palette dialog**: Included and Excluded lists with their own search, select all / deselect all (only the rows matching the search), move between the lists, import and export of a palette file.
- "Skip falling blocks", "Skip glass" and "Skip liquids" switches under the palette, on by default. They move those blocks to the Excluded list.
- Export has a **File name** field, and `.schem` is the default format.
- Menu strings added to the English locale only, other locales fall back to English.

## Import

- **Up axis** option: -Z up (default), Y up or Z up, to stand a model upright.
- Picking or dropping a file imports, voxelises and assigns blocks straight away, no extra clicks.
- Drag and drop of `.obj` and `.glb` files anywhere on the page.

## Viewport

- A 64x64 floor grid sits under the lowest block, so the grid is where the feet of the character are when the structure is pasted. The grid stays 64x64 however big the model gets, so you can see when it goes past it. An empty grid is shown before anything is imported.
- A box around the voxels or blocks with a handle on top: drag it up or down to resize the model, and it is generated again at the new size.
- A block has a fixed size in the viewer, so a bigger Size makes a bigger model next to the floor grid, and the camera moves back to keep it in view.
- Fixed a bug where the grid offset stuck to the next debug lines that were drawn.

## Tools

- `start.bat`: starts the dev server with a portable Node in `%USERPROFILE%\tools` and opens the browser.

## Not done

- A deterministic Texture Area Sampling (it still averages random samples), the Triplane Rasteriser, and modifiers from the v2 web UI.
- Waxed copper names, and other blocks that are not full cubes (doors, beds, shelves and so on).
- Translations of the new strings.
- Stairs and slabs are untested for formats other than `.schem`.
