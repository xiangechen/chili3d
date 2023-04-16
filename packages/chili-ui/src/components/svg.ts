// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";
import style from "./svg.module.css";

export class Svg extends Control {
    readonly svg: SVGSVGElement;

    constructor(icon?: string) {
        super(style.root);
        this.svg = this.createSVG();
        if (icon) {
            this.setIcon(icon);
        }
        this.append(this.svg);
    }

    override addClass(...classes: string[]): this {
        this.svg.classList.add(...classes);
        return this;
    }

    private createSVG() {
        const ns = "http://www.w3.org/2000/svg";
        const child = document.createElementNS(ns, "use");
        let svg = document.createElementNS(ns, "svg");
        svg.append(child);
        return svg;
    }

    setIcon(newIcon: string) {
        const childNS = "http://www.w3.org/1999/xlink";
        let child = this.svg.firstChild as SVGUseElement;
        child?.setAttributeNS(childNS, "xlink:href", `#${newIcon}`);
    }

    onClick(listener: (e: MouseEvent) => void) {
        this.svg.addEventListener("click", listener);
        return this;
    }
}

customElements.define("chili-svg", Svg);
