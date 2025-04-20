import { I18n, Logger } from "chili-core";
import { button, div, input, label } from "./components";
import style from "./dialog.module.css";

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

        dialog.appendChild(
            div(
                { className: style.root },
                div({ className: style.title }, label({ textContent: I18n.translate("njsgcs_showDialog") })),
                div({ className: style.input }, user_say_input),
                div(
                    { className: style.buttons },
                    button({
                        textContent: I18n.translate("common.confirm"),
                        onclick: () => {
                            // 动态获取输入框的值
                            const user_say_value = (user_say_input as HTMLInputElement).value;
                            Logger.info(user_say_value);
                        },
                    }),
                ),
            ),
        );

        dialog.showModal();
    }
}
