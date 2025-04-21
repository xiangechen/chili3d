// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, Logger, PubSub } from "chili-core";
import { button, div, input, span } from "../components";
import style from "./projectView.module.css";

export class njsgcs_ProjectView extends HTMLElement {
    private _activeDocument: IDocument | undefined;
    get activeDocument() {
        return this._activeDocument;
    }

    private readonly panel: HTMLDivElement;
    private resultLabel: HTMLLabelElement;
    private user_say_input: HTMLInputElement;
    constructor(props: { className: string }) {
        super();
        this.classList.add(style.root, props.className);
        this.panel = div({
            className: style.itemsPanel,
        });
        this.resultLabel = document.createElement("label");
        this.resultLabel.className = style.resultLabel;
        this.user_say_input = input({
            type: "text",
            id: "njsgcs_test_input",
            onkeydown: (e: KeyboardEvent) => {
                e.stopPropagation();
            },
        });
        this.render();
    }

    private render() {
        this.panel.append(
            div(
                { className: style.headerPanel },
                span({
                    className: style.header,
                    textContent: "njsgcs sidebar",
                }),
            ),
            div({ className: style.input }, this.user_say_input),
            div(
                { className: style.buttons },
                button({
                    textContent: "发送",
                    onclick: async () => {
                        try {
                            Logger.info("按钮接收到点击事件");
                            // 动态获取输入框的值
                            PubSub.default.pub(
                                "njsgcs_send_to_llm",
                                this.user_say_input.value,
                                async (callbackresult: string) => {
                                    const result = await callbackresult;
                                    this.resultLabel.textContent = result;
                                    Logger.info("回调返回：" + result);
                                },
                            );
                        } catch (error) {
                            Logger.error("Failed to parse response as JSON:", error);
                        }
                    },
                }),
            ),
            div({ className: style.result }, this.resultLabel),
        );

        // 确保 this.panel 被添加到当前的 HTMLElement 中
        this.appendChild(this.panel);
    }
}

customElements.define("chili-project-njsgcs_view", njsgcs_ProjectView);
