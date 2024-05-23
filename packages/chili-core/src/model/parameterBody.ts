// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { HistoryObservable, IPropertyChanged, Result } from "../foundation";
import { I18nKeys } from "../i18n";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { IShape } from "../shape";

export interface IParameterBody extends IPropertyChanged {
    display: I18nKeys;
    generateShape(): Result<IShape>;
}

export abstract class ParameterBody extends HistoryObservable implements IParameterBody {
    abstract display: I18nKeys;
    abstract generateShape(): Result<IShape>;
}

export abstract class FacebaseParameterBody extends ParameterBody {
    protected _isFace: boolean = false;
    @Serializer.serialze()
    @Property.define("command.faceable.isFace")
    get isFace() {
        return this._isFace;
    }
    set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
