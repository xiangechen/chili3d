// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Logger } from "chili-core";

export function customElement(tagName: string) {
    return function (ctor: CustomElementConstructor) {
        customElements.define(tagName, ctor);
    };
}

export interface DomEvent<K extends keyof HTMLElementEventMap> {
    id: string;
    type: K;
    handler: (e: HTMLElementEventMap[K]) => void;
}

export abstract class ObservableHTMLElement extends HTMLElement {
    protected abstract getEvents(): DomEvent<any>[];

    connectedCallback() {
        this.addOrRemoveEvents("add");
    }

    disconnectedCallback() {
        this.addOrRemoveEvents("remove");
    }

    protected addOrRemoveEvents(type: "add" | "remove") {
        this.getEvents().forEach((x) => {
            let ensureId = x.id.startsWith("#") ? x.id : `#${x.id}`;
            let e: HTMLElement | null = this.querySelector(ensureId);
            if (e === null) {
                Logger.warn(`can not find ${x.id}`);
                return;
            }
            if (type === "add") e.addEventListener(x.type, x.handler);
            else e.removeEventListener(x.type, x.handler);
        });
    }
}
