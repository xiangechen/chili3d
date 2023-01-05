// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, ContextualComboControl, ICommand, Id } from "chili-core";
import { ContextualCheckControl, ContextualControl, ContextualInputControl } from "chili-core";
import { I18n } from "chili-shared";
import { Control } from "../control";
import style from "./contextual.module.css";

export class Contextual {
    private static _instance: Contextual | undefined;

    static get instance() {
        if (Contextual._instance === undefined) {
            Contextual._instance = new Contextual();
        }
        return Contextual._instance;
    }

    private root: HTMLDivElement;
    private currentDiv: HTMLDivElement | undefined;
    private controlMap = new WeakMap<object, HTMLDivElement>();

    private constructor() {
        this.root = Control.div(style.panel);
    }

    init(parent: HTMLElement) {
        parent.appendChild(this.root);
    }

    registerControls(command: ICommand) {
        this.currentDiv = this.controlMap.get(Object.getPrototypeOf(command));
        if (this.currentDiv === undefined) {
            let data = CommandData.get(command);
            let controls = ContextualControl.get(command);
            if (data === undefined || controls === undefined) return;
            this.currentDiv = Control.div(style.itemPanel);
            this.currentDiv.appendChild(Control.span(data.display, style.itemHeader));
            for (let index = 0; index < controls.length; index++) {
                this.addControl(this.currentDiv, controls[index]);
            }
            this.controlMap.set(Object.getPrototypeOf(command), this.currentDiv);
        }
        this.root.appendChild(this.currentDiv);
    }

    private addControl(div: HTMLDivElement, control: ContextualControl) {
        div.appendChild(Control.span(control.header, style.itemText));
        let element: HTMLElement | undefined = undefined;
        if (control instanceof ContextualCheckControl) {
            element = Control.checkBox(false);
        } else if (control instanceof ContextualInputControl) {
            element = Control.textBox();
        } else if (control instanceof ContextualComboControl) {
            element = Control.select(control.items);
        }
        if (element !== undefined) {
            div.appendChild(element);
        }
    }

    getValue(id: string): boolean | number | string | undefined {
        if (this.currentDiv === undefined) return undefined;
        let element = this.currentDiv.querySelector(`#${id}`);
        if (element instanceof HTMLInputElement) {
            if (element.type === "checkbox") {
                return element.checked;
            } else {
                return element.value;
            }
        } else if (element instanceof HTMLSelectElement) {
            return element.selectedIndex;
        }
    }

    clearControls() {
        Control.clear(this.root);
    }

    private itemPanel(header: keyof I18n): HTMLDivElement {
        let panel = Control.div(style.itemPanel);
        panel.appendChild(Control.span(header));
        return panel;
    }

    private handleTextInput(header: keyof I18n, callback: (value: string) => boolean) {
        let panel = this.itemPanel(header);
        let box = Control.textBox();
        panel.appendChild(box);
        let keyDown = (e: KeyboardEvent) => {
            if (callback(box.textContent ?? "")) {
                box.removeEventListener("keydown", keyDown);
            }
        };
        box.addEventListener("keydown", keyDown);
    }
}
