// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Div, TextBlock } from "../../controls";
import style from "./title.module.css";

export class Title {
    private readonly _documentName: TextBlock;
    private readonly _status: TextBlock;
    private readonly _appName: TextBlock;

    constructor(readonly container: Div) {
        this._documentName = new TextBlock("未命名", style.titleText);
        this._status = new TextBlock(" | ", style.titleText);
        this._appName = new TextBlock("Chili 2022", style.titleText);
        this.container.add(this._documentName, this._status, this._appName);

        this._status.addClass(style.titleText, style.titleSplit);
    }

    setTitle(title: string) {
        this._documentName.text = title;
    }

    setDoucmentSavedStatus(hasModify: boolean) {
        this._status.text = hasModify ? "* | " : " | ";
    }
}
