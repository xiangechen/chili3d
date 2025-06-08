// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Localize, PathBinding } from "chili-core";
import { Collection, CollectionProps } from "./collection";
import { HTMLProps } from "./htmlProps";

export function createControl<K extends keyof HTMLElementTagNameMap>(tag: K) {
    return (
        props?: HTMLProps<HTMLElementTagNameMap[K]> | string | Node,
        ...children: (Node | string)[]
    ): HTMLElementTagNameMap[K] => {
        const e: HTMLElementTagNameMap[K] = document.createElement(tag);
        if (props) {
            if (typeof props === "string" || props instanceof Node) {
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
    for (const key in prop) {
        const value = prop[key];
        if (value instanceof Localize && (key === "textContent" || key === "title")) {
            value.set(left, key);
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
export const form = createControl("form");

export function svg(props: HTMLProps<HTMLElement> & { icon: string }) {
    const ns = "http://www.w3.org/2000/svg";
    const child = document.createElementNS(ns, "use");
    child.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${props.icon}`);
    const svg = document.createElementNS(ns, "svg");
    svg.append(child);
    const className = String(props.className);
    delete props.className;
    setProperties(svg, props);
    svg.classList.add(className);
    if (props.title) {
        addTitle(props, svg);
    }
    return svg;
}

export function setSVGIcon(svg: SVGSVGElement, newIcon: string) {
    const child = svg.firstChild as SVGUseElement;
    child?.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${newIcon}`);
}

function addTitle(props: HTMLProps<HTMLElement> & { icon: string }, svg: SVGSVGElement) {
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    if (props.title instanceof Localize) {
        props.title.set(title as any, "textContent");
    } else if (typeof props.title === "string") {
        title.textContent = props.title;
    } else {
        props.title?.setBinding(title, "textContent");
    }

    svg.appendChild(title);
}

export const collection = <T>(options: CollectionProps<T>) => new Collection(options);
