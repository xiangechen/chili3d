import { I18n, Logger } from "chili-core";
import { button, div, input, label } from "../components";
import style from "../dialog.module.css";

export class njsgcs_Dialog {
    private constructor() {}
    static show() {
        const dialog = document.createElement("dialog");
        document.body.appendChild(dialog);

        // 创建输入框并保存引用
        const user_say_input = input({
            type: "text",
            id: "njsgcs_test_input",
            onkeydown: (e: KeyboardEvent) => {
                e.stopPropagation();
            },
        });

        // 创建 label 元素并保存引用
        const resultLabel = label({ textContent: "" });

        dialog.appendChild(
            div(
                { className: style.root },
                div({ className: style.title }, label({ textContent: I18n.translate("njsgcs_showDialog") })),
                div({ className: style.input }, user_say_input),
                div(
                    { className: style.buttons },
                    button({
                        textContent: I18n.translate("common.confirm"),
                        onclick: async () => {
                            try {
                                // 动态获取输入框的值
                                let response: string = "";
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
            ),
        );

        dialog.showModal();
    }
}
