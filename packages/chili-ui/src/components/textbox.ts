// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";
import style from "./textbox.module.css";

export class TextBox extends Control {
    readonly input: HTMLInputElement;
    constructor() {
        super(style.container);
        this.input = this.initInput();
        this.append(this.input);
    }

    override focus() {
        this.input.focus();
    }

    override addEventListener<K extends keyof HTMLElementEventMap>(
        type: K,
        listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions | undefined
    ): void;
    override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions | undefined
    ): void;
    override addEventListener(type: unknown, listener: unknown, options?: unknown): void {
        this.input.addEventListener(
            type as string,
            listener as EventListenerOrEventListenerObject,
            options as boolean | AddEventListenerOptions
        );
    }

    override removeEventListener<K extends keyof HTMLElementEventMap>(
        type: K,
        listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
        options?: boolean | EventListenerOptions | undefined
    ): void;
    override removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions | undefined
    ): void;
    override removeEventListener(type: unknown, listener: unknown, options?: unknown): void {
        this.input.removeEventListener(
            type as string,
            listener as EventListenerOrEventListenerObject,
            options as boolean | EventListenerOptions
        );
    }

    onKeyDown(handler: (e: KeyboardEvent) => void) {
        this.input.addEventListener("keydown", handler);
        return this;
    }

    get readOnly() {
        return this.input.readOnly;
    }

    setReadOnly(value: boolean) {
        this.input.readOnly = value;
        if (value) {
            this.addClass(style.readOnly);
        } else {
            this.removeClass(style.readOnly);
        }
        return this;
    }

    private initInput() {
        let e = document.createElement("input");
        e.className = style.input;
        e.setAttribute("autocomplete", "off");
        e.addEventListener("keydown", (event) => {
            event.stopPropagation();
        });
        return e;
    }

    get text() {
        return this.input.value;
    }

    setText(value: string) {
        this.input.value = value;
        return this;
    }
}

customElements.define("chili-textbox", TextBox);
