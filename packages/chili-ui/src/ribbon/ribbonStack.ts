// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import style from "./ribbonStack.module.css";

export class RibbonStack extends HTMLElement {
    constructor() {
        super();
        this.className = style.root;
    }
}

customElements.define("ribbon-stack", RibbonStack);
