// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../../control";
import style from "./title.module.css";

export class Title {
    private readonly _documentName: HTMLSpanElement;
    private readonly _appName: HTMLSpanElement;

    constructor(readonly container: HTMLDivElement) {
        this._documentName = Control.span("value.untitled", style.titleText);
        this._appName = Control.span("value.app.name", style.titleText);
        Control.append(container, this._documentName, this._appName);
    }

    setTitle(title: string) {
        this._documentName.textContent = title;
    }

}
