// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys } from "chili-core";
import { Control } from "../components";
import style from "./toast.module.css";

export class Toast extends Control {
    #toastText: HTMLElement;
    #toastTimeoutId: NodeJS.Timeout | undefined;

    constructor() {
        super(style.toast);
        this.style.display = "none";
        this.#toastText = document.createElement("div");
        this.#toastText.classList.add(style.toastText);
        this.appendChild(this.#toastText);
    }

    show = (message: I18nKeys, ...args: any[]) => {
        if (this.#toastTimeoutId) clearTimeout(this.#toastTimeoutId);
        this.#toastText.textContent = I18n.translate(message, ...args);
        this.style.display = "";
        this.#toastTimeoutId = setTimeout(() => {
            this.#toastTimeoutId = undefined;
            this.style.display = "none";
        }, 2000);
    };
}

customElements.define("chili-toast", Toast);
