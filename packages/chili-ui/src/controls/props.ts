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
    target: "_blank" | "_self";
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

export interface RadioProps extends Props {
    type: "radio";
    value: string | Binding;
    checked: boolean | Binding;
}

export interface ColorProps extends Props {
    type: "color";
    value?: string | Binding;
    onchange?: (e: Event) => void;
}

export interface TextProps extends Props {
    type: "text";
    value?: string | Binding;
    onchange?: (e: Event) => void;
    onkeydown?: (e: KeyboardEvent) => void;
    onkeyup?: (e: KeyboardEvent) => void;
}

export type ChildDom = string | Node;

export function setProps<O extends Props, K extends keyof HTMLElementTagNameMap>(
    props: O,
    dom: HTMLElementTagNameMap[K] | SVGElement,
) {
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
        value.setBinding(dom, key);
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
