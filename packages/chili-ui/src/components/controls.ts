// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { PathBinding } from "chili-core";
import { HTMLProps } from "./htmlProps";
import { Collection, CollectionProps } from "./collection";
import { Localize } from "./localize";

export function createControl<K extends keyof HTMLElementTagNameMap>(tag: K) {
    return (
        props?: HTMLProps<HTMLElementTagNameMap[K]> | string | Node,
        ...children: (Node | string)[]
    ): HTMLElementTagNameMap[K] => {
        const e: HTMLElementTagNameMap[K] = document.createElement(tag);
        if (props) {
            if (props instanceof Node || typeof props === "string") {
                e.append(props);
            } else {
                setProperties(e, props);
            }
        }

        children.forEach((c) => e.append(c));
        return e;
    };
}

export function setProperties<T extends { [K: string]: any }>(left: T, prop: HTMLProps<T>) {
    for (const key of Object.keys(prop)) {
        let value = prop[key];
        if (value instanceof Localize && left instanceof HTMLElement && key === "textContent") {
            value.set(left);
        } else if (value instanceof PathBinding) {
            value.setBinding(left, key);
        } else if (typeof value === "object" && typeof left[key] === "object") {
            setProperties(left[key], value);
        } else {
            (left as any)[key] = value;
        }
    }
}

export const div = createControl("div");
export const span = createControl("span");
export const input = createControl("input");
export const button = createControl("button");
export const label = createControl("label");
export const textarea = createControl("textarea");
export const select = createControl("select");
export const option = createControl("option");
export const a = createControl("a");
export const h1 = createControl("h1");
export const h2 = createControl("h2");
export const h3 = createControl("h3");
export const p = createControl("p");
export const ul = createControl("ul");
export const li = createControl("li");
export const img = createControl("img");
export const dialog = createControl("dialog");
export const canvas = createControl("canvas");
export const sup = createControl("sup");

export function svg(props: HTMLProps<HTMLElement> & { icon: string }) {
    const ns = "http://www.w3.org/2000/svg";
    const childNS = "http://www.w3.org/1999/xlink";
    const child = document.createElementNS(ns, "use");
    child.setAttributeNS(childNS, "xlink:href", `#${props.icon}`);
    let svg = document.createElementNS(ns, "svg");
    svg.append(child);
    let className = String(props.className);
    delete props.className;
    setProperties(svg, props);
    svg.classList.add(className);

    if (props.title) {
        addTitle(props, svg);
    }

    return svg;
}

export function setSVGIcon(svg: SVGSVGElement, newIcon: string) {
    const childNS = "http://www.w3.org/1999/xlink";
    let child = svg.firstChild as SVGUseElement;
    child?.setAttributeNS(childNS, "xlink:href", `#${newIcon}`);
}

function addTitle(props: HTMLProps<HTMLElement> & { icon: string }, svg: SVGSVGElement) {
    let title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    let value = "";
    if (typeof props.title === "string") {
        value = props.title;
    } else if (props.title instanceof PathBinding) {
        value = props.title.getPropertyValue();
    }
    let text = document.createTextNode(value);
    title.appendChild(text);
    svg.appendChild(title);
}

export const collection = <T>(options: CollectionProps<T>) => new Collection(options);
