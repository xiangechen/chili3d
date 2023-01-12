// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants, I18n, i18n } from "chili-shared";

export namespace Control {
    export function clear(e: HTMLElement) {
        while (e.children.length) {
            e.removeChild(e.lastChild!);
        }
    }

    export function append(father: HTMLElement, ...children: HTMLElement[]) {
        children.forEach((x) => father.appendChild(x));
    }

    function element<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string) {
        let e = document.createElement(tagName);
        if (className !== undefined) e.className = className;
        return e;
    }

    export function div(className?: string) {
        return element("div", className);
    }

    export function span(i18nId: keyof I18n, className?: string) {
        let e = element("span", className);
        e.style.cursor = "default";
        e.style.display = "inline-block";
        setI18nText(e, i18nId);
        return e;
    }

    export function textSpan(text: string, className?: string) {
        let e = element("span", className);
        e.style.cursor = "default";
        e.style.display = "inline-block";
        e.textContent = text;
        return e;
    }

    export function setI18nText(e: HTMLElement, i18nId: keyof I18n) {
        e.textContent = i18n[i18nId];
        e.dataset[Constants.I18nIdAttribute] = i18nId;
    }

    export function textBox(className?: string) {
        let e = element("input", className);
        e.setAttribute("autocomplete", "off");
        e.addEventListener("keydown", (event) => {
            event.stopPropagation();
        });
        return e;
    }

    export function checkBox(isChecked: boolean, className?: string) {
        let e = element("input", className);
        e.type = "checkbox";
        e.checked = isChecked;
        return e;
    }

    export function button(value: string, onClick: () => void, className?: string) {
        let e = element("button", className);
        e.textContent = value;
        e.addEventListener("click", onClick);
        return e;
    }

    export function select(items: string[], className?: string) {
        let e = element("select", className);
        items.forEach((x) => {
            let option = document.createElement("option");
            option.innerText = x;
            e.append(option);
        });
        return e;
    }

    export function svg(icon: string, className?: string) {
        const ns = "http://www.w3.org/2000/svg";
        const childNS = "http://www.w3.org/1999/xlink";
        const svg = document.createElementNS(ns, "svg");
        const child = document.createElementNS(ns, "use");
        child.setAttributeNS(childNS, "xlink:href", `#${icon}`);
        svg.appendChild(child);
        if (className !== undefined) svg.classList.add(className);
        return svg;
    }

    export function setSvgIcon(svg: SVGSVGElement, icon: string) {
        const childNS = "http://www.w3.org/1999/xlink";
        let child = svg.firstChild as SVGUseElement;
        child?.setAttributeNS(childNS, "xlink:href", `#${icon}`);
    }
}
