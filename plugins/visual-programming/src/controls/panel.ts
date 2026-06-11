// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { css, html, LitElement } from "lit";
import { ClassicPreset } from "rete";

export class PanelControl extends ClassicPreset.Control {
    hasInput = false;
    value = "";

    constructor(public change: () => void) {
        super();
    }
}

export class PanelElement extends LitElement {
    static override get properties() {
        return {
            data: { type: PanelControl },
        };
    }

    declare data: PanelControl;

    static override styles = css`
        .root {
            display: flex;
            flex-direction: column;
            align-items: center;
            background-color: #f5f5f5;
        }
        textarea {
            width: 160px;
            font-family: monospace;
            font-size: 12px;
            padding: 4px;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: #fafafa;
            margin: -4px -8px 0 -8px;
            resize: vertical;
        }
        textarea:focus {
            outline: none;
            border-color: #666;
        }
    `;

    get value() {
        return this.data.value;
    }

    handleInput = (event: InputEvent) => {
        const newValue = (event.target as HTMLTextAreaElement).value;
        this.data.value = newValue;
        this.data.change();
        this.requestUpdate();
    };

    override render() {
        return html`
            <div class="root">
                <textarea
                    .value=${this.value}
                    .readOnly=${this.data.hasInput}
                    @input=${this.handleInput}
                    @pointerdown=${(e: MouseEvent) => e.stopPropagation()}
                    placeholder="Enter text..."
                ></textarea>
            </div>
        `;
    }
}

customElements.define("panel-element", PanelElement);
