// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class Control<T extends HTMLElement = HTMLElement> {
    readonly dom: T;
    protected constructor(dom: T, className?: string) {
        this.dom = dom;
        if (className !== undefined) this.className = className;
    }

    set className(name: string) {
        this.dom.className = name;
    }

    get className(): string {
        return this.dom.className;
    }

    set id(id: string) {
        this.dom.id = id;
    }

    get id(): string {
        return this.dom.id;
    }

    get style() {
        return this.dom.style;
    }

    addClass(...name: string[]) {
        this.dom.classList.add(...name);
    }

    removeClass(name: string) {
        this.dom.classList.remove(name);
    }

    setTextContent(textContent: string) {
        this.dom.textContent = textContent;
    }

    setInnerHTML(html: string) {
        this.dom.innerHTML = html;
    }

    setAttribute(attributeName: string, value: string) {
        this.dom.setAttribute(attributeName, value);
    }

    getAttribute(attributeName: string) {
        return this.dom.getAttribute(attributeName);
    }

    getIndexOfChild(control: Control): number {
        return Array.prototype.indexOf.call(this.dom.children, control.dom);
    }

    clear() {
        while (this.dom.children.length) {
            this.dom.removeChild(this.dom.lastChild!);
        }
    }

    insertBefore(current: Control, child: Control) {
        this.dom.insertBefore(current.dom, child.dom);
    }

    add(...controls: Control[]) {
        controls.forEach((c) => {
            if (!this.dom.contains(c.dom)) this.dom.appendChild(c.dom);
        });
    }

    remove(...controls: Control[]) {
        controls.forEach((c) => {
            if (this.dom.contains(c.dom)) this.dom.removeChild(c.dom);
        });
    }

    childrenCount() {
        return this.dom.children.length;
    }

    appendToParent(dom: HTMLElement) {
        dom.appendChild(this.dom);
    }
}

export class InputControl extends Control<HTMLInputElement> {
    get disabled() {
        return this.dom.disabled;
    }

    set disabled(disabled: boolean) {
        this.dom.disabled = disabled;
    }
}

export class Span extends Control {
    constructor(className?: string) {
        super(document.createElement("span"), className);
    }
}

export class Div extends Control {
    constructor(className?: string) {
        super(document.createElement("div"), className);
    }
}

export class Panel extends Div {
    constructor(className?: string) {
        super(className);
    }
}

export class TextBlock extends Span {
    constructor(text: string, className?: string) {
        super(className);
        this.dom.style.cursor = "default";
        this.dom.style.display = "inline-block";
        this.text = text;
    }

    get text() {
        return this.dom.textContent!;
    }

    set text(text: string) {
        this.dom.textContent = text;
    }
}

export class TextBox extends InputControl {
    constructor(className?: string) {
        super(document.createElement("input"), className);
        this.dom.setAttribute("autocomplete", "off");
        this.dom.addEventListener("keydown", (event) => {
            event.stopPropagation();
        });
    }

    get text() {
        return this.dom.value;
    }

    set text(value: string) {
        this.dom.value = value;
    }
}

export class Checkbox extends InputControl {
    constructor(isChecked: boolean, className?: string) {
        super(document.createElement("input"), className);
        this.dom.type = "checkbox";
        this.value = isChecked;
    }

    get value() {
        return this.dom.checked;
    }

    set value(value: boolean) {
        if (value !== undefined) {
            this.dom.checked = value;
        }
    }
}

export class Button extends Control {
    constructor(value: string, onClick: () => void, className?: string) {
        super(document.createElement("button"), className);
        this.dom.textContent = value;

        this.dom.addEventListener("click", onClick);
    }
}

export class Svg {
    readonly dom: SVGElement;
    readonly child: SVGUseElement;
    constructor(icon: string, className?: string) {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        this.child = document.createElementNS(ns, "use");
        this.setIcon(icon);
        svg.appendChild(this.child);
        this.dom = svg;

        if (className !== undefined) this.addClass(className);
    }

    addClass(...name: string[]) {
        this.dom.classList.add(...name);
    }

    setIcon(icon: string) {
        const childNS = "http://www.w3.org/1999/xlink";
        this.child.setAttributeNS(childNS, "xlink:href", `#${icon}`);
    }
}
