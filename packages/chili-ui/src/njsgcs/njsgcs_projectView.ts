// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, Logger, PubSub } from "chili-core";
import { button, div, Expander, input } from "../components";
import style from "../property/propertyView.module.css";
import { send_to_llm } from "./njsgcs_send_to_llm";
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
        this.user_say_input.value = "生成一个500*500*500的正方体";
        this.render();
    }
    private makebox(length: number, width: number, height: number) {
        PubSub.default.pub("njsgcs_makebox", length, width, height);
    }
    private render() {
        const expander = new Expander("njsgcs_sidebar"); // 创建 Expander

        // 把原来添加到 this.panel 的内容先添加到 expander 中
        expander.append(
            div({ className: style.input }, this.user_say_input),
            //llm_button
            div(
                { className: style.buttons },
                button({
                    textContent: "发送",
                    onclick: async () => {
                        try {
                            Logger.info("按钮接收到点击事件");
                            // 动态获取输入框的值
                            const body = JSON.stringify({
                                messages: [
                                    { content: this.user_say_input.value, role: "user" },
                                    { content: "you are a helpful assistant", role: "system" },
                                ],
                                model: "deepseek-chat",
                            });
                            const result = await send_to_llm(body);
                            this.resultLabel.textContent = result;
                            Logger.info("llm返回：" + result);
                        } catch (error) {
                            Logger.error("Failed to parse response as JSON:", error);
                        }
                    },
                }),
            ),
            //get属性后发送
            div(
                { className: style.buttons },
                button({
                    textContent: "带属性发送",
                    onclick: async () => {
                        try {
                            Logger.info("按钮接收到点击事件");
                            // 动态获取输入框的值

                            PubSub.default.pub("njsgcs_get_property", async (callbackresult2: string) => {
                                const body = JSON.stringify({
                                    messages: [
                                        {
                                            content: this.user_say_input.value + callbackresult2,
                                            role: "user",
                                        },
                                        { content: "you are a helpful assistant", role: "system" },
                                    ],
                                    model: "deepseek-chat",
                                });
                                const result = await send_to_llm(body);
                                this.resultLabel.textContent = result;
                                Logger.info("llm返回：" + result);
                            });
                        } catch (error) {
                            Logger.error("Failed to parse response as JSON:", error);
                        }
                    },
                }),
            ),
            div(
                { className: style.buttons },
                button({
                    textContent: "ai生成立方体",
                    onclick: async () => {
                        try {
                            Logger.info("按钮接收到点击事件");
                            // 动态获取输入框的值
                            let prompt = `请返回纯代码文本，不要返回其他内容
                            如果创建一个30*50*60的立方体：

                             this.makebox(30,50,60 )
                             `;

                            // this.makebox(10,10,10)
                            const body = JSON.stringify({
                                messages: [
                                    { content: this.user_say_input.value, role: "user" },
                                    { content: prompt, role: "system" },
                                ],
                                model: "deepseek-chat",
                            });
                            const result = await send_to_llm(body);
                            eval(result);
                        } catch (error) {
                            Logger.error("Failed to parse response as JSON:", error);
                        }
                    },
                }),
            ),

            div({ className: style.result }, this.resultLabel),
        );
        this.panel.append(expander);
        // 确保 this.panel 被添加到当前的 HTMLElement 中
        this.appendChild(this.panel);
    }
}

customElements.define("chili-project-njsgcs_view", njsgcs_ProjectView);
