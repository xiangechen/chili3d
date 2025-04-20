// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, Logger } from "chili-core";
import { button, div, input, span } from "../components";
import style from "./projectView.module.css";
import { send_to_llm } from "./send_to_llm";
export class njsgcs_ProjectView extends HTMLElement {
    private _activeDocument: IDocument | undefined;
    get activeDocument() {
        return this._activeDocument;
    }

    private readonly panel: HTMLDivElement;

    constructor(props: { className: string }) {
        super();
        this.classList.add(style.root, props.className);
        this.panel = div({
            className: style.itemsPanel,
        });

        this.render();
    }

    private render() {
        const user_say_input = input({
            type: "text",
            id: "njsgcs_test_input",
            onkeydown: (e: KeyboardEvent) => {
                e.stopPropagation();
            },
        });

        const resultLabel = document.createElement("label");
        resultLabel.className = style.resultLabel;

        this.panel.append(
            div(
                { className: style.headerPanel },
                span({
                    className: style.header,
                    textContent: "njsgcs sidebar",
                }),
            ),
            div({ className: style.input }, user_say_input),
            div(
                { className: style.buttons },
                button({
                    textContent: "发送",
                    onclick: async () => {
                        try {
                            // 动态获取输入框的值
                            let response: string = await send_to_llm(user_say_input.value);
                            // 将 response 解析为 JSON 对象
                            const jsonResponse = JSON.parse(response);
                            let content_response: string = jsonResponse.choices[0].message.content;
                            Logger.info(content_response);
                            // 将 content_response 赋值给 label
                            resultLabel.textContent = content_response;
                        } catch (error) {
                            Logger.error("Failed to parse response as JSON:", error);
                        }
                    },
                }),
            ),
            // 添加结果显示区域
            div({ className: style.result }, resultLabel),
        );

        // 确保 this.panel 被添加到当前的 HTMLElement 中
        this.appendChild(this.panel);
    }
}

customElements.define("chili-project-njsgcs_view", njsgcs_ProjectView);
