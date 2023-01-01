// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, ICommand } from "chili-core";
import { ContextualCheckControl, ContextualControl, ContextualInputControl } from "chili-core/src/decorators/contextual";
import { Checkbox, Div, TextBlock, TextBox } from "../controls";
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
    private currentDiv: Div | undefined
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
            this.currentDiv = new Div(style.itemPanel)
            let data = CommandData.get(command)
            if (data === undefined) return;
            ContextualControl.get(command)?.forEach(control => {
                this.currentDiv!.add(new TextBlock(`${data!.display}: `))
                this.currentDiv!.add(new TextBlock(control.header, style.itemHeader))
                if (control instanceof ContextualCheckControl) {
                    this.currentDiv!.add(new Checkbox(true))
                } else if (control instanceof ContextualInputControl) {
                    this.currentDiv!.add(new TextBox())
                }
            })
            this.controlMap.set(Object.getPrototypeOf(command), this.currentDiv)
        }
        this.root.add(this.currentDiv)
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