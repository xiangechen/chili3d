// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, ContextualComboControl, ICommand, Id } from "chili-core";
import { ContextualCheckControl, ContextualControl, ContextualInputControl } from "chili-core";
import { Checkbox, ComboBox, Control, Div, TextBlock, TextBox } from "../controls";
import style from "./contextual.module.css"

export class Contextual {
    private static _instance: Contextual | undefined

    static get instance() {
        if (Contextual._instance === undefined) {
            Contextual._instance = new Contextual()
        }
        return Contextual._instance
    }

    private root: Div;
    private currentDiv: Div | undefined;
    private controlMap = new WeakMap<object, Div>

    private constructor() {
        this.root = new Div(style.panel);
    }

    init(parent: HTMLElement) {
        parent.appendChild(this.root.dom)
    }

    registerControls(command: ICommand) {
        this.currentDiv = this.controlMap.get(Object.getPrototypeOf(command))
        if (this.currentDiv === undefined) {
            let data = CommandData.get(command)
            let controls = ContextualControl.get(command)
            if (data === undefined || controls === undefined) return;
            this.currentDiv = new Div(style.itemPanel)
            this.currentDiv.add(new TextBlock(`${data.display}: `))
            for (let index = 0; index < controls.length; index++) {
                const control = controls[index];
                this.currentDiv.add(new TextBlock(control.header, style.itemHeader))
                let element: Control | undefined = undefined;
                if (control instanceof ContextualCheckControl) {
                    element = new Checkbox(false)
                } else if (control instanceof ContextualInputControl) {
                    element = new TextBox()
                } else if (control instanceof ContextualComboControl) {
                    element = new ComboBox(control.items);
                }
                if (element !== undefined) {
                    element.id = control.id
                    this.currentDiv.add(element)
                }
            }
            this.controlMap.set(Object.getPrototypeOf(command), this.currentDiv)
        }
        this.root.add(this.currentDiv)
    }

    getValue(id: string): boolean | number | string | undefined {
        if (this.currentDiv === undefined) return undefined;
        let element = this.currentDiv.dom.querySelector(`#${id}`)
        if (element instanceof HTMLInputElement) {
            if (element.type === "checkbox") {
                return element.checked
            } else {
                return element.value
            }
        } else if (element instanceof HTMLSelectElement) {
            return element.selectedIndex
        }
    }

    clearControls() {
        this.root.clear()
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