// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Div, TextBlock, TextBox } from "../controls";
import style from "./contextual.module.css"

export class Contextual {
    private static _instance: Contextual | undefined

    static get instance() {
        if (Contextual._instance === undefined) {
            Contextual._instance = new Contextual()
        }
        return Contextual._instance
    }

    private root: Div

    private constructor() {
        this.root = new Div(style.panel);
    }

    init(parent: HTMLElement) {
        parent.appendChild(this.root.dom)
    }

    private itemPanel(header: string): Div {
        let panel = new Div(style.itemPanel)
        panel.add(new TextBlock(`${header}: `))
        return panel
    }

    private handleTextInput(header: string, callback: (value: string) => boolean) {
        let panel = this.itemPanel(header)
        let box = new TextBox();
        panel.add(box)
        let keyDown = (e: KeyboardEvent) => {
            if (callback(box.text)) {
                box.dom.removeEventListener("keydown", keyDown)
            }
        }
        box.dom.addEventListener("keydown", keyDown)
    }

}