import { PALETTE_ALL_RELEASE } from '../../../res/palettes/all';
import { LOC } from '../../localiser';
import { Palette } from '../../palette';
import { AppUtil } from '../../util';
import { download } from '../../util/file_util';
import { UIUtil } from '../../util/ui_util';
import { AppConsole } from '../console';
import { ConfigComponent } from './config';

type TSide = 'inc' | 'exc';

/**
 * The block palette. The sidebar only shows a summary and an Edit button, the blocks
 * themselves are edited in a dialog with an "included" and an "excluded" list.
 */
export class PaletteComponent extends ConfigComponent<Palette, HTMLDivElement> {
    private _palette: Palette;

    public constructor() {
        super();

        this._palette = Palette.create();
        this._palette.add(PALETTE_ALL_RELEASE);
        this._setValue(this._palette);
    }

    /**
     * Removes a block from the palette, used by the block breakdown list.
     */
    public deselectBlock(blockName: string) {
        if (this._palette.remove(blockName)) {
            this._updateSummary();
        }
    }

    /**
     * Includes or excludes every block matching a rule, used by the "skip" toggles.
     */
    public setBlocksIncluded(isInGroup: (blockName: string) => boolean, included: boolean) {
        PALETTE_ALL_RELEASE.filter(isInGroup).forEach((block) => {
            if (included) {
                this._palette.add([block]);
            } else {
                this._palette.remove(block);
            }
        });
        this._updateSummary();
    }

    protected override _generateInnerHTML(): string {
        return `
            <div class="row-container" style="width: 100%; gap: 6px;">
                <div class="struct-prop" id="${this._getId()}-summary" style="cursor: default;"></div>
                <div class="struct-prop" id="${this._getId()}-edit" style="justify-content: center; cursor: pointer;">${LOC('assign.palette.edit')}</div>
            </div>
        `;
    }

    private _updateSummary() {
        const summary = document.getElementById(this._getId() + '-summary');
        if (summary !== null) {
            summary.innerText = LOC('assign.palette.summary', {
                included: this._palette.count(),
                excluded: PALETTE_ALL_RELEASE.length - this._palette.count(),
            });
        }
    }

    protected override _onValueChanged(): void {
    }

    protected override _onEnabledChanged(): void {
        super._onEnabledChanged();
        this._updateStyles();
    }

    public override registerEvents(): void {
        const edit = UIUtil.getElementById(this._getId() + '-edit');
        edit.addEventListener('mouseenter', () => {
            this._setHovered(true);
            this._updateStyles();
        });
        edit.addEventListener('mouseleave', () => {
            this._setHovered(false);
            this._updateStyles();
        });
        edit.addEventListener('click', () => {
            if (this.enabled) {
                this._openDialog();
            }
        });
    }

    public override finalise(): void {
        super.finalise();
        this._updateSummary();
        this._updateStyles();
    }

    protected override _updateStyles(): void {
        UIUtil.updateStyles(UIUtil.getElementById(this._getId() + '-edit'), {
            isActive: false,
            isEnabled: this.enabled,
            isHovered: this.hovered,
        });
        UIUtil.updateStyles(UIUtil.getElementById(this._getId() + '-summary'), {
            isActive: false,
            isEnabled: this.enabled,
            isHovered: false,
        });
    }

    public override refresh(): void {
        super.refresh();
        this._updateSummary();
        const edit = document.getElementById(this._getId() + '-edit');
        if (edit !== null) {
            edit.innerText = LOC('assign.palette.edit');
        }
    }

    private _openDialog() {
        const included = new Set<string>(this._palette.getBlocks());
        const selected: { [side in TSide]: Set<string> } = { inc: new Set(), exc: new Set() };
        const search: { [side in TSide]: string } = { inc: '', exc: '' };

        const sectionHTML = (side: TSide) => `
            <div class="palette-section" data-side="${side}">
                <div class="palette-heading">${LOC(side === 'inc' ? 'assign.palette.included' : 'assign.palette.excluded')} <span data-count></span></div>
                <div class="palette-search-row">
                    <input class="palette-search" type="text" placeholder="${LOC('assign.components.search')}">
                    <div class="palette-more" data-more>&#8942;</div>
                    <div class="palette-menu" data-menu hidden>
                        <div data-act="all">${LOC('assign.palette.select_all')}</div>
                        <div data-act="none">${LOC('assign.palette.deselect_all')}</div>
                        <div data-act="import">${LOC('assign.palette.import')}</div>
                        <div data-act="export">${LOC('assign.palette.export')}</div>
                    </div>
                </div>
                <div class="palette-list" data-list></div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'palette-overlay';
        overlay.innerHTML = `
            <div class="palette-dialog">
                <div class="palette-title">${LOC('assign.palette.title')}</div>
                ${sectionHTML('inc')}
                <div class="palette-move">
                    <div class="palette-btn" data-move="exc"></div>
                    <div class="palette-btn" data-move="inc"></div>
                </div>
                ${sectionHTML('exc')}
                <div class="palette-footer">
                    <div class="palette-btn" data-cancel>${LOC('assign.palette.cancel')}</div>
                    <div class="palette-btn primary" data-apply>${LOC('assign.palette.apply')}</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                close();
            }
        };
        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        };
        document.addEventListener('keydown', onKey);

        const section = (side: TSide) => overlay.querySelector(`.palette-section[data-side="${side}"]`) as HTMLElement;
        const matches = (block: string, term: string) => {
            term = term.toLowerCase();
            return block.includes(term) || block.replace(/_/g, ' ').includes(term);
        };
        const onSide = (side: TSide) => PALETTE_ALL_RELEASE.filter((block) => (side === 'inc') === included.has(block));
        const visible = (side: TSide) => onSide(side).filter((block) => matches(block, search[side]));

        const render = () => {
            (['inc', 'exc'] as TSide[]).forEach((side) => {
                // Selection only makes sense for blocks that are still on this side
                selected[side].forEach((block) => {
                    if ((side === 'inc') !== included.has(block)) {
                        selected[side].delete(block);
                    }
                });
                const list = section(side).querySelector('[data-list]') as HTMLElement;
                list.innerHTML = visible(side).map((block) => {
                    return `<div class="palette-row${selected[side].has(block) ? ' sel' : ''}" data-block="${block}">${block}</div>`;
                }).join('');
                (section(side).querySelector('[data-count]') as HTMLElement).innerText = `(${onSide(side).length})`;
            });
            const toExclude = overlay.querySelector('[data-move="exc"]') as HTMLElement;
            const toInclude = overlay.querySelector('[data-move="inc"]') as HTMLElement;
            toExclude.innerText = '↓ ' + LOC('assign.palette.exclude_n', { count: selected.inc.size });
            toInclude.innerText = '↑ ' + LOC('assign.palette.include_n', { count: selected.exc.size });
            toExclude.classList.toggle('disabled', selected.inc.size === 0);
            toInclude.classList.toggle('disabled', selected.exc.size === 0);
        };

        (['inc', 'exc'] as TSide[]).forEach((side) => {
            const el = section(side);
            (el.querySelector('.palette-search') as HTMLInputElement).addEventListener('input', (e) => {
                search[side] = (e.target as HTMLInputElement).value;
                render();
            });
            el.querySelector('[data-list]')!.addEventListener('click', (e) => {
                const row = (e.target as HTMLElement).closest('.palette-row') as HTMLElement | null;
                if (row === null) {
                    return;
                }
                const block = row.dataset.block!;
                if (selected[side].has(block)) {
                    selected[side].delete(block);
                } else {
                    selected[side].add(block);
                }
                row.classList.toggle('sel');
                render();
            });
            const menu = el.querySelector('[data-menu]') as HTMLElement;
            el.querySelector('[data-more]')!.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.hidden = !menu.hidden;
            });
            menu.addEventListener('click', (e) => {
                const action = (e.target as HTMLElement).dataset.act;
                menu.hidden = true;
                if (action === 'all') {
                    visible(side).forEach((block) => selected[side].add(block));
                } else if (action === 'none') {
                    selected[side].clear();
                } else if (action === 'export') {
                    download(onSide('inc').join('\n'), 'block-palette.txt');
                } else if (action === 'import') {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.txt';
                    input.addEventListener('change', () => {
                        const file = input.files?.item(0);
                        if (file) {
                            AppConsole.info(LOC('assign.reading_palette', { file_name: file.name }));
                            file.text().then((text) => {
                                this._importText(text, included);
                                render();
                            });
                        }
                    });
                    input.click();
                }
                render();
            });
        });
        overlay.addEventListener('click', (e) => {
            overlay.querySelectorAll('[data-menu]').forEach((menu) => {
                (menu as HTMLElement).hidden = true;
            });
            if (e.target === overlay) {
                close();
            }
        });

        overlay.querySelectorAll('[data-move]').forEach((button) => {
            button.addEventListener('click', () => {
                const toIncluded = (button as HTMLElement).dataset.move === 'inc';
                const from = toIncluded ? selected.exc : selected.inc;
                from.forEach((block) => toIncluded ? included.add(block) : included.delete(block));
                from.clear();
                render();
            });
        });

        overlay.querySelector('[data-cancel]')!.addEventListener('click', close);
        overlay.querySelector('[data-apply]')!.addEventListener('click', () => {
            PALETTE_ALL_RELEASE.forEach((block) => {
                if (included.has(block)) {
                    this._palette.add([block]);
                } else {
                    this._palette.remove(block);
                }
            });
            this._updateSummary();
            close();
        });

        render();
    }

    private _importText(text: string, included: Set<string>) {
        included.clear();
        let countFound = 0;
        let countChecked = 0;
        text.split('\n').forEach((blockName) => {
            blockName = blockName.trim();
            if (blockName.length === 0) {
                return;
            }
            ++countFound;
            if (!AppUtil.Text.isNamespacedBlock(blockName)) {
                AppConsole.error(LOC('assign.block_not_namespaced', { block_name: blockName }));
            } else if (!PALETTE_ALL_RELEASE.includes(blockName)) {
                AppConsole.error(LOC('assign.could_not_use_block', { block_name: blockName }));
            } else {
                included.add(blockName);
                ++countChecked;
            }
        });
        AppConsole.info(LOC('assign.found_blocks', { count: countFound }));
        AppConsole.info(LOC('assign.selected_blocks', { count: countChecked }));
    }
}
