import { UIUtil } from '../../util/ui_util';
import { ConfigComponent } from './config';

export class TextComponent extends ConfigComponent<string, HTMLInputElement> {
    public constructor() {
        super('');
    }

    public setValue(value: string) {
        this._setValue(value);
    }

    public override registerEvents() {
        this._getElement().addEventListener('input', () => {
            this._setValue(this._getElement().value);
        });

        this._getElement().addEventListener('mouseenter', () => {
            this._setHovered(true);
            this._updateStyles();
        });

        this._getElement().addEventListener('mouseleave', () => {
            this._setHovered(false);
            this._updateStyles();
        });
    }

    public override _generateInnerHTML() {
        return `
            <input class="struct-prop" type="text" style="width: 100%; text-align: start;" id="${this._getId()}" value="${this.getValue().replace(/"/g, '&quot;')}"></input>
        `;
    }

    protected override _onEnabledChanged() {
        super._onEnabledChanged();

        this._getElement().disabled = !this.enabled;
        this._updateStyles();
    }

    protected _onValueChanged(): void {
        const element = document.getElementById(this._getId()) as HTMLInputElement | null;
        if (element !== null && element.value !== this.getValue()) {
            element.value = this.getValue();
        }
    }

    protected override _updateStyles(): void {
        UIUtil.updateStyles(UIUtil.getElementById(this._getId()), {
            isActive: false,
            isEnabled: this.enabled,
            isHovered: this.hovered,
        });
    }
}
