// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ClassicScheme } from "@retejs/lit-plugin";
import { css, html, LitElement } from "lit";

type NodeExtraData = { width?: number; height?: number };

export class CustomNodeElement extends LitElement {
    static override get properties() {
        return {
            width: { type: Number },
            height: { type: Number },
            data: { type: Object },
            styles: { type: Function },
            emit: { type: Function },
        };
    }
    declare width: number;
    declare height: number;
    declare data: (ClassicScheme["Node"] & NodeExtraData) | undefined;
    declare styles: ((props: any) => any) | null;
    declare emit: ((type: string, payload: any) => void) | null;

    static override styles = css`
        :host {
            --socket-size: 20px;
            --socket-margin: 6px;
            --node-width: 180px;
        }

        :host {
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(3px);
            border: 2px solid var(--border-color);
            border-radius: 16px;
            cursor: pointer;
            box-sizing: border-box;
            position: relative;
            user-select: none;
            overflow: hidden;
            width: fit-content;
            height: fit-content;
            min-width: 160px;
        }

        :host(:hover) {
            border-color: var(--border-hover-color);
        }

        :host(.selected) {
            border-color: var(--primary-color);
        }

        .title {
            color: var(--foreground-color);
            font-family: sans-serif;
            font-size: 16px;
            padding: 4px;
            text-align: center;
            flex: 0 0 auto;
            margin-top: 4px;
        }

        .content {
            flex: 1;
            display: grid;
            margin: 4px;
            grid-template-columns: auto 1fr auto;
        }

        .left {
            display: block;
            height: 100%;
        }

        .center {
            display: block;
            height: 100%;
        }

        .right {
            display: block;
            height: 100%;
        }

        .output {
            text-align: right;
            display: flex;
            margin-right: 8px;
            flex-direction: row;
            align-items: center;
        }

        .input {
            text-align: left;
            display: flex;
            margin-left: 8px;
            flex-direction: row;
            align-items: center;
        }

        .output-socket {
            text-align: right;
            display: inline-block;
        }
            
        .input-socket {
            text-align: left;
            display: inline-block;
        }

        .input-title,
        .output-title {
            vertical-align: middle;
            color: var(--foreground-color);
            display: inline-block;
            font-family: sans-serif;
            font-size: 12px;
            margin: var(--socket-margin);
            line-height: var(--socket-size);
        }

        .input-control {
            z-index: 1;
            width: 100%;
            vertical-align: middle;
            display: inline-block;
        }

        .control {
            display: block;
            background-color: transparent;
            padding: 0;
            margin: var(--socket-margin);
        }
    `;

    sortByIndex(entries: any[]) {
        entries.sort((a, b) => {
            const ai = a[1]?.index || 0;
            const bi = b[1]?.index || 0;

            return ai - bi;
        });
    }

    private ensureData() {
        const inputs = Object.entries(this.data?.inputs || {});
        const outputs = Object.entries(this.data?.outputs || {});
        const controls = Object.entries(this.data?.controls || {});
        this.sortByIndex(inputs);
        this.sortByIndex(outputs);
        this.sortByIndex(controls);

        return { inputs, outputs, controls };
    }

    override render() {
        if (!this.data || !this.data.id || !this.data.label) {
            return html`<div></div>`;
        }
        if (this.data.selected) {
            this.classList.add("selected");
        } else {
            this.classList.remove("selected");
        }

        const { id, label, width, height } = this.data;
        const { inputs, outputs, controls } = this.ensureData();
        return html`
            <style>
                :host {
                    width: ${Number.isFinite(width) ? `${width}px` : "var(--node-width)"};
                    height: ${Number.isFinite(height) ? `${height}px` : "fit-content"};
                }
                ${this.styles && this.styles(this)}
            </style>
            <div class="title">${label}</div>
            <div class="content">
                <div class="left">
                    ${this.input(inputs, id)}
                </div>
                <div class="center">
                    ${this.control(controls)}
                 </div>
                <div class="right">
                    ${this.output(outputs, id)}
                </div>
            </div>
            `;
    }

    private control(controls: any): unknown {
        return controls.map(([key, control]: any) =>
            control
                ? html`
                    <span class="control" data-testid="${"control-" + key}">
                        <rete-ref
                        .emit=${this.emit}
                        .data="${{ type: "control", payload: control }}"
                        ></rete-ref>
                    </span>
                    `
                : null,
        );
    }

    private input(inputs: any, id: string): unknown {
        return inputs.map(([key, input]: any) =>
            input
                ? html` <div class="input" key=${key}>
                            <span class="input-socket" data-testid="input-socket">
                                <rete-ref 
                                    .data=${{
                                        type: "socket",
                                        side: "input",
                                        key,
                                        nodeId: id,
                                        payload: input.socket,
                                    }}
                                    .emit=${this.emit}
                                ></rete-ref>
                            </span>
                            ${
                                input && (!input.control || !input.showControl)
                                    ? html` <div class="input-title">${input?.label}</div>`
                                    : null
                            }
                            ${
                                input?.control && input?.showControl
                                    ? html`
                                    <span class="control" data-testid="input-control">
                                    <rete-ref
                                        .emit=${this.emit}
                                        .data="${{ type: "control", payload: input.control }}"
                                    ></rete-ref>
                                    </span>
                                `
                                    : null
                            }
                    </div>`
                : null,
        );
    }

    private output(outputs: any, id: string): unknown {
        return outputs.map(([key, output]: any) =>
            output
                ? html` <div class="output" key=${key}>
                    <div class="output-title">${output?.label}</div>
                    <span class="output-socket" data-testid="output-socket">
                        <rete-ref
                        .data=${{
                            type: "socket",
                            side: "output",
                            key,
                            nodeId: id,
                            payload: output.socket,
                        }}
                        .emit=${this.emit}
                        ></rete-ref>
                    </span>
                    </div>`
                : null,
        );
    }
}
