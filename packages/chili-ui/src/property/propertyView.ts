// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Property, PubSub } from "chili-core";
import { IBody, IModelObject } from "chili-geo";
import { Control } from "../control";
import { Expander } from "../expander";
import { Tab } from "../tab";
import { CheckProperty } from "./check";
import { InputProperty } from "./input";
import style from "./propertyView.module.css";

export class PropertyView {
    readonly dom: HTMLElement;
    private tab: Tab;
    private panel = Control.div(style.panel);

    constructor() {
        this.tab = new Tab("properties.header");
        this.dom = this.tab.dom;
        this.tab.addItem(this.panel);
        PubSub.default.sub("selectionChanged", this.selectionChanged);
    }

    private selectionChanged = (document: IDocument, args: IModelObject[]) => {
        Control.clear(this.panel);
        if (args.length === 0) return;
        this.appendProperty(this.panel, document, args, Property.get(args.at(0), "name"));

        if (args.length === 1 && IModelObject.isModel(args[0])) {
            let modelBody: IBody = args[0].body;
            let body = new Expander(modelBody.name);
            this.panel.appendChild(body.rootPanel);
            body.rootPanel.classList.add(style.expander);
            Property.getAll(modelBody).forEach((x) => {
                this.appendProperty(body.contenxtPanel, document, [modelBody], x);
            });
        }

        let transform = new Expander("properties.group.transform");
        transform.rootPanel.classList.add(style.expander);
        this.panel.appendChild(transform.rootPanel);
        this.appendProperty(transform.contenxtPanel, document, args, Property.get(args.at(0), "model.location"));
        this.appendProperty(transform.contenxtPanel, document, args, Property.get(args.at(0), "model.rotate"));
    };

    private appendProperty(container: HTMLElement, document: IDocument, objs: any[], prop?: Property) {
        if (prop === undefined) return;
        const type = typeof (objs[0] as unknown as any)[prop.name];
        if (type === "object" || type === "string") {
            container.appendChild(new InputProperty(document, objs, prop).dom);
        } else if (type === "boolean") {
            container.appendChild(new CheckProperty(objs, prop).dom);
        }
    }
}
