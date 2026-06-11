// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Position } from "@retejs/lit-plugin";
import { css, html, LitElement, type PropertyDeclarations } from "lit";

export class CustomConnectionElement extends LitElement {
    static override get properties(): PropertyDeclarations {
        return {
            start: { type: Object },
            end: { type: Object },
            path: { type: String },
        };
    }

    declare start: Position;
    declare end: Position;
    declare path: string;

    static override styles = css`
    svg {
      overflow: visible !important;
      position: absolute;
      pointer-events: none;
      width: 9999px;
      height: 9999px;
    }

    path {
      fill: none;
      stroke-width: 5px;
      stroke: var(--primary-color);
      pointer-events: auto;
    }
  `;

    override render() {
        return html`
          <svg data-testid="connection">
            <path d=${this.path}></path>
          </svg>
        `;
    }
}
