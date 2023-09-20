// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding } from "./binding";
import { Localize } from "./localize";

/**
 * The setting parameters for HTMLElement, where each key corresponds to a key in the HTMLElement.
 */
export interface Props {
    id?: string | Binding;
    textContent?: string | Binding | Localize;
    className?: string | Binding;
    style?: StyleProps;
    onclick?: (e: MouseEvent) => void;
}

export type StyleProps = {
    [P in keyof CSSStyleDeclaration]?: CSSStyleDeclaration[P] | Binding;
};

export interface ImgProps extends Props {
    src?: string | Binding;
}

export interface AProps extends Props {
    href?: string | Binding;
}

export interface SelectProps extends Props {
    onchange?: (e: Event) => void;
}

export interface OptionProps extends Props {
    selected?: boolean | Binding;
}

export interface CheckboxProps extends Props {
    type: "checkbox";
    checked: boolean | Binding;
}

export interface ColorProps extends Props {
    type: "color";
    value?: string | Binding;
    onchange?: (e: Event) => void;
}

export type ChildDom = string | Node;
type Tags = keyof HTMLElementTagNameMap;

function createFunction<K extends Tags, O extends Props = Props>(tag: K) {
    return function (options?: O | ChildDom, ...children: readonly ChildDom[]) {
        let dom: HTMLElementTagNameMap[K] = document.createElement(tag);
        if (options) {
            if (typeof options === "string" || options instanceof Node) {
                dom.append(options);
            } else if (typeof options === "object") {
                setProps(options, dom);
            } else {
                throw new Error("Invalid options");
            }
        }
        dom.append(...children);
        return dom;
    };
}

function setProps<O extends Props, K extends Tags>(props: O, dom: HTMLElementTagNameMap[K] | SVGElement) {
    for (const key of Object.keys(props)) {
        const value = (props as any)[key];
        if (key === "style") {
            setStyle(dom, value);
        } else if (value instanceof Localize && dom instanceof HTMLElement && key === "textContent") {
            value.set(dom);
        } else if (key in dom) {
            bindOrSetProperty(dom, key as any, value);
        }
    }
}

function bindOrSetProperty<T extends object>(dom: T, key: keyof T, value: any) {
    if (value instanceof Binding) {
        value.add(dom, key);
    } else {
        dom[key] = value;
    }
}

function setStyle(dom: HTMLElement | SVGElement, style: StyleProps) {
    for (const key of Object.keys(style)) {
        const value = (style as any)[key];
        bindOrSetProperty(dom.style, key as any, value);
    }
}

export const div = createFunction("div");
export const span = createFunction("span");
export const button = createFunction("button");
export const input = createFunction<"input", CheckboxProps | ColorProps>("input");
export const textarea = createFunction("textarea");
export const select = createFunction<"select", SelectProps>("select");
export const option = createFunction<"option", OptionProps>("option");
export const label = createFunction("label");
export const img = createFunction<"img", ImgProps>("img");
export const a = createFunction<"a", AProps>("a");
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

export interface SvgProps extends Props {
    icon: string;
}

export function svg(props: SvgProps) {
    const ns = "http://www.w3.org/2000/svg";
    const childNS = "http://www.w3.org/1999/xlink";
    const child = document.createElementNS(ns, "use");
    child.setAttributeNS(childNS, "xlink:href", `#${props.icon}`);
    let svg = document.createElementNS(ns, "svg");
    svg.append(child);
    let className = String(props.className);
    delete props.className;
    setProps(props, svg);
    svg.classList.add(className);
    return svg;
}
