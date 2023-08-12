// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Binding } from "./binding";

/**
 * The setting parameters for HTMLElement, where each key corresponds to a key in the HTMLElement.
 */
export interface Options {
    id?: string | Binding;
    textContent?: string | Binding;
    className?: string | Binding;
    onclick?: (e: MouseEvent) => void;
}

export type ChildDom = string | Node;

function createFunction<K extends keyof HTMLElementTagNameMap>(tag: K) {
    return function (options?: Options | ChildDom, ...children: readonly ChildDom[]) {
        let dom: HTMLElementTagNameMap[K] = document.createElement(tag);
        if (options) {
            if (typeof options === "string" || options instanceof Node) {
                dom.append(options);
            } else {
                setOptions<K>(options, dom);
            }
        }
        dom.append(...children);
        return dom;
    };
}

function setOptions<K extends keyof HTMLElementTagNameMap>(options: Options, dom: HTMLElementTagNameMap[K]) {
    for (const key of Object.keys(options)) {
        const value = (options as any)[key];
        if (value instanceof Binding) {
            value.add(dom, key as any);
        } else {
            (dom as any)[key] = value;
        }
    }
}

export const div = createFunction("div");
export const span = createFunction("span");
export const button = createFunction("button");
export const input = createFunction("input");
export const textarea = createFunction("textarea");
export const select = createFunction("select");
export const option = createFunction("option");
export const label = createFunction("label");
export const img = createFunction("img");
export const a = createFunction("a");
export const br = createFunction("br");
export const hr = createFunction("hr");
export const pre = createFunction("pre");
export const code = createFunction("code");
export const h1 = createFunction("h1");
export const h2 = createFunction("h2");
export const h3 = createFunction("h3");
export const h4 = createFunction("h4");
export const h5 = createFunction("h5");
export const h6 = createFunction("h6");
export const p = createFunction("p");
export const ul = createFunction("ul");
export const li = createFunction("li");
