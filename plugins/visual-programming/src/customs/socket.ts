// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { css, html, LitElement } from "lit";

export class CustomSocketElement extends LitElement {
    static override get properties() {
        return {
            data: { type: Object },
        };
    }

    declare data: { name: string };

    static override styles = css`
        :host {
            --socket-size: 16px;
            display: inline-block;
            cursor: pointer;
            border-radius: 50%;
            width: var(--socket-size);
            height: var(--socket-size);
            vertical-align: middle;
            z-index: 2;
            box-sizing: border-box;
            border: 2px solid var(--primary-color);

            &:hover {
                background: var(--primary-color);
            }
        }
    `;

    override render() {
        return html` <div title="${this.data?.name}"></div> `;
    }
}
