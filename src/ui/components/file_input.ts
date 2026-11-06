import * as path from 'path';

import { ASSERT } from '../../util/error_util';
import { UIUtil } from '../../util/ui_util';
import { ConfigComponent } from './config';
import { AppIcons } from '../icons';
import { LOC } from '../../localiser';

export class FileComponent extends ConfigComponent<File, HTMLDivElement> {
    private static _dropRegistered = false;
    private _loadedFilePath: string | null;

    public constructor() {
        super();
        this._loadedFilePath = null;
    }

    protected override _generateInnerHTML() {
        return `
            <div class="input-file struct-prop" id="${this._getId()}">
                <input type="file" accept=".obj,.glb,.ply,.splat" style="display: none;" id="${this._getId()}-input">
                ${this._loadedFilePath ?? LOC('import.components.no_file_chosen')}
            </div>
        `;
    }

    public override registerEvents(): void {
        this._getElement().addEventListener('mouseenter', () => {
            this._setHovered(true);
            this._updateStyles();
        });

        this._getElement().addEventListener('mouseleave', () => {
            this._setHovered(false);
            this._updateStyles();
        });

        const inputElement = UIUtil.getElementById(this._getId() + '-input') as HTMLInputElement;

        inputElement.addEventListener('change', () => {
            const files = inputElement.files;
            if (files?.length === 1) {
                const file = files.item(0);
                ASSERT(file !== null);
                this._loadedFilePath = file.name;
                this._setValue(file);
            }
        });

        this._getElement().addEventListener('click', () => {
            if (this.enabled) {
                inputElement.click();
            }
        });

        if (!FileComponent._dropRegistered) {
            FileComponent._dropRegistered = true;
            window.addEventListener('dragover', (e) => e.preventDefault());
            window.addEventListener('drop', (e) => {
                e.preventDefault();
                const file = e.dataTransfer?.files?.item(0);
                if (this.enabled && file && /\.(obj|glb|ply|splat)$/i.test(file.name)) {
                    this._loadedFilePath = file.name;
                    this._setValue(file);
                }
            });
        }
    }

    protected _onValueChanged(): void {
        this._updateStyles();
    }

    protected _onEnabledChanged(): void {
        super._onEnabledChanged();

        this._updateStyles();
    }

    protected override _updateStyles() {
        if (this._loadedFilePath) {
            const parsedPath = path.parse(this._loadedFilePath);
            this._getElement().innerHTML = parsedPath.name + parsedPath.ext;
        } else {
            this._getElement().innerHTML = `<i>${LOC('import.components.no_file_chosen')}</i>`;
        }

        UIUtil.updateStyles(this._getElement(), {
            isHovered: this.hovered,
            isEnabled: this.enabled,
            isActive: false,
        });
    }

    public override refresh(): void {
        this._getElement().innerHTML = `<i>${LOC('import.components.no_file_chosen')}</i>`;
    }
}
