// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { i18n } from ".";
import { Constants } from "../constants";

export namespace I18n {
    export function setLang(lang: string) {
        let elements = document.querySelectorAll("[data-i18n]");
        elements.forEach((e) => {
            let html = e as HTMLElement;
            let id = html?.dataset[Constants.I18nIdAttribute];
            if (id === undefined) return;
            html.textContent = (i18n as any)[id];
        });
    }
}

export interface I18n {
    name: string;
    "value.app.name": string;
    "value.untitled": string;
    "ui.ribbon.tab.startup": string;
    "ui.ribbon.group.drawing": string;
    "ui.tree.header": string;
    "ui.tree.tool.newGroup": string;
    "ui.tree.tool.expandAll": string;
    "ui.tree.tool.unexpandAll": string;
    "ui.tree.tool.delete": string;
    "ui.property.header": string;
    "ui.property.multivalue": string;
    "category.default": string;
    "category.paremeter": string;
    "body.position": string;
    "body.rotate": string;
    "body.visible": string;
    "body.vertex.point": string;
    "body.curve.start": string;
    "body.curve.end": string;
    "command.delete": string;
    "command.redo": string;
    "command.newGroup": string;
    "command.undo": string;
    "command.line": string;
    "snap.end": string;
    "snap.mid": string;
    "snap.center": string;
    "snap.intersection": string;
    "snap.perpendicular": string;
    "axis.x": string;
    "axis.y": string;
    "axis.z": string;
    "tip.default": string;
    "error.default": string;
    "error.input.maxInput": string;
    "error.input.numberValid": string;
    "error.input.whenNullOnlyThreeNumber": string;
    "error.input.whenOverlapfNotOneNumber": string;
}
