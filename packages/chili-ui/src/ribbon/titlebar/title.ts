// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../../control";
import style from "./title.module.css";

export class Title {
    private readonly _documentName: HTMLSpanElement;
    private readonly _status: HTMLSpanElement;
    private readonly _appName: HTMLSpanElement;

    constructor(readonly container: HTMLDivElement) {
        this._documentName = Control.span("未命名", style.titleText);
        this._status = Control.span(" | ", style.titleText);
        this._appName = Control.span("Chili 2022", style.titleText);
        Control.append(container, this._documentName, this._status, this._appName);

        this._status.classList.add(style.titleText, style.titleSplit);
    }

    setTitle(title: string) {
        this._documentName.textContent = title;
    }

    setDoucmentSavedStatus(hasModify: boolean) {
        this._status.textContent = hasModify ? "* | " : " | ";
    }
}
