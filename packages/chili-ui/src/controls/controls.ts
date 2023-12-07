// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ItemsConfig, ItemsElement } from "../components/items";
import { Binding } from "./binding";
import { HTMLConfig } from "./htmlConfig";
import { Localize } from "./localize";

export function createControl<K extends keyof HTMLElementTagNameMap>(tag: K) {
    return (
        props?: HTMLConfig<HTMLElementTagNameMap[K]> | string | Node,
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

export function setProperties<T extends { [K: string]: any }>(left: T, prop: HTMLConfig<T>) {
    for (const key of Object.keys(prop)) {
        let value = prop[key];
        if (value instanceof Localize && left instanceof HTMLElement && key === "textContent") {
            value.set(left);
        } else if (value instanceof Binding) {
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

export function svg(props: HTMLConfig<HTMLElement> & { icon: string }) {
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
    return svg;
}

export const items = <T>(options: ItemsConfig<T>) => new ItemsElement(options);
