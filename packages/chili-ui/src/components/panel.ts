// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Control } from ".";

export class Panel extends Control {
    constructor(className?: string) {
        super(className);
    }

    addItem(...items: Node[]) {
        this.append(...items);
        return this;
    }

    removeItem(item: Node) {
        this.removeChild(item);
        return this;
    }
}

customElements.define("chili-panel", Panel);
