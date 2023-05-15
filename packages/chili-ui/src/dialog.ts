// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import style from "./dialog.module.css";

export class Dialog {
    private constructor() {}

    static show(msg: string, title?: string) {
        let dialog = document.createElement("dialog");
        dialog.style.padding = "0";
        dialog.innerHTML = `
            <div class="${style.dialog}">
                <div class="${style.title}">${title ?? "chili3d"}</div>
                <div class="${style.content}">${msg}</div>
                <div class="${style.buttons}">
                    <button class="${style.button}">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        let button = dialog.querySelector(`.${style.button}`)!;
        let handler = () => {
            dialog.close();
            document.body.removeChild(dialog);
            button.removeEventListener("click", handler);
        };
        button.addEventListener("click", handler);
        dialog.showModal();
    }
}
