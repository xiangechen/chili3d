// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Parameter, PubSub } from "chili-core";
import { IModelObject } from "chili-geo";
import { i18n } from "chili-shared";
import { Control } from "../control";
import { CheckProperty } from "./check";
import { InputProperty } from "./input";
import style from "./propertyView.module.css";

export class PropertyView {
    readonly dom: HTMLDivElement;
    readonly panel = Control.div(style.panel);

    constructor() {
        this.dom = Control.div(style.root);
        Control.append(this.dom, Control.span(i18n.property, style.header), this.panel);

        PubSub.default.sub("selectionChanged", this.selectionChanged);
    }

    private selectionChanged = (document: IDocument, args: IModelObject[]) => {
        Control.clear(this.panel);
        if (args.length === 0) return;
        const parameters = Parameter.getAll(args[0]);
        let keys = this.getCommonKeys(args, parameters);
        parameters.forEach((p) => {
            if (keys.indexOf(p.property) > -1) {
                const type = typeof (args[0] as unknown as any)[p.property];
                if (type === "object" || type === "string") {
                    this.panel.appendChild(new InputProperty(document, args, p).dom);
                } else if (type === "boolean") {
                    this.panel.appendChild(new CheckProperty(args, p).dom);
                }
            }
        });
    };

    private getCommonKeys(args: any[], parameters: Array<Parameter>): Array<string> {
        let result: string[] = [];
        if (args.length === 0) return result;
        for (const p of parameters) {
            for (let j = 0; j < args.length; j++) {
                if (p.property in args[j] === false) {
                    continue;
                }
            }
            result.push(p.property);
        }
        return result;
    }
}
