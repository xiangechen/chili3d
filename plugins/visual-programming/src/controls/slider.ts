import { css, html, LitElement } from "lit";
import { ClassicPreset } from "rete";

export class NumberSliderControl extends ClassicPreset.Control {
    min = 0;
    max = 100;
    step = 1;
    value = 50;

    constructor(public change: () => void) {
        super();
    }
}

export class SliderElement extends LitElement {
    static override get properties() {
        return {
            data: { type: NumberSliderControl },
        };
    }

    declare data: NumberSliderControl;

    static override styles = css`
        :host {
            --display-setting: none;
        }
        .slider-wrapper {
          display: flex;
          align-items: center;
          height: 100%;
          justify-content: center;
        }
        input[type=range] {
          flex: 1;
          width: 180px;
        }
        span {
          min-width: 30px;
          margin: 0 4px;
          text-align: left;
          font-family: monospace;
        }
        .edit-btn {
          margin-left: 4px;
          padding: 2px 6px;
          font-size: 10px;
          cursor: pointer;
        }
        .edit-form {
          display: var(--display-setting);
          gap: 5px;
          padding: 4px;
          background: rgba(128, 128, 128, 0.1);
          margin-top: 4px;
          border-radius: 6px;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
        }
        .edit-form input {
          padding: 2px 4px;
          font-size: 11px;
        }
        .edit-form label {
          display: flex;
          flex-direction: column;
          font-size: 10px;
          gap: 2px;
        }
    `;

    get value() {
        return this.data.value;
    }

    get size() {
        return 120;
    }

    private _edit = false;

    handleInput = (event: InputEvent) => {
        const newValue = parseFloat((event.target as HTMLInputElement).value);
        this.setValue(newValue);
    };

    setValue(value: number) {
        this.data.value = value;
        this.data.change();
        this.requestUpdate();
    }

    toggleEdit = () => {
        this._edit = !this._edit;
        this.style.setProperty("--display-setting", this._edit ? "grid" : "none");
    };

    updateParam(key: "min" | "max" | "step", event: Event) {
        const value = parseFloat((event.target as HTMLInputElement).value);
        if (!isNaN(value)) {
            (this.data as any)[key] = value;
            this.data.change();
        }
    }

    override render() {
        return html`
            <div class="slider-wrapper">
                <input
                    type="range"
                    .value=${this.value!.toString()}
                    min=${this.data.min}
                    max=${this.data.max}
                    step=${this.data.step}
                    @input=${this.handleInput}
                    @pointerdown=${(e: MouseEvent) => e.stopPropagation()}
                    @doubleclick=${(e: MouseEvent) => e.stopPropagation()}
                />
                <span>${this.value}</span>
                <button class="edit-btn" @pointerdown=${this.toggleEdit}>⚙</button>
            </div>
            <div class="edit-form">
                <label>min<input type="number" .value=${this.data.min.toString()} @change=${(e: Event) => this.updateParam("min", e)} /></label>
                <label>max<input type="number" .value=${this.data.max.toString()} @change=${(e: Event) => this.updateParam("max", e)} /></label>
                <label>step<input type="number" .value=${this.data.step.toString()} @change=${(e: Event) => this.updateParam("step", e)} /></label>
            </div>
            `;
    }
}

customElements.define("slider-element", SliderElement);
