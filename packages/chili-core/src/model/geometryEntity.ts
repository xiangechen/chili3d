// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { PubSub, Result } from "../foundation";
import { I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { IShape } from "../shape";
import { Entity } from "./entity";
import { IParameterBody } from "./parameterBody";

export abstract class GeometryEntity extends Entity {
    private _materialId: string;
    @Serializer.serialze()
    @Property.define("common.material", { type: "materialId" })
    get materialId(): string {
        return this._materialId;
    }
    set materialId(value: string) {
        this.setProperty("materialId", value);
    }

    protected _shape: Result<IShape> = Result.err("undefined");
    get shape(): Result<IShape> {
        return this._shape;
    }

    constructor(document: IDocument, materialId?: string) {
        super(document);
        this._materialId = materialId ?? document.materials.at(0)!.id;
    }

    override onMatrixChanged(newMatrix: Matrix4): void {
        if (this._shape.isOk) this._shape.value.matrix = newMatrix;
    }

    protected updateShape(shape: Result<IShape>, notify: boolean): boolean {
        if (shape.isOk && this._shape.isOk && this._shape.value.isEqual(shape.value)) {
            return false;
        }

        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
            return false;
        }

        let oldShape = this._shape;
        this._shape = shape;
        this._shape.value.matrix = this._matrix;
        if (notify) this.emitPropertyChanged("shape", oldShape);
        return true;
    }
}

@Serializer.register(["document", "shape", "materialId"], undefined, EditableGeometryEntity.serializer)
export class EditableGeometryEntity extends GeometryEntity {
    override display: I18nKeys = "entity.parameter";

    constructor(document: IDocument, shape: IShape, materialId?: string) {
        super(document, materialId);
        this._shape = Result.ok(shape);
    }

    replaceShape(shape: IShape): boolean {
        return this.updateShape(Result.ok(shape), true);
    }

    static serializer(target: EditableGeometryEntity) {
        let properties = Serializer.serializeProperties(target);
        properties["shape"] = Serializer.serializeObject(target.shape.value!);
        return properties;
    }
}

@Serializer.register(["document", "body", "materialId"])
export class ParameterGeometryEntity extends GeometryEntity {
    override display: I18nKeys = "entity.parameter";

    @Serializer.serialze()
    readonly body: IParameterBody;

    protected shouldRegenerateShape: boolean = true;
    override get shape(): Result<IShape> {
        if (this.shouldRegenerateShape) {
            let shape = this.body.generateShape();
            if (!shape.isOk) {
                PubSub.default.pub("showToast", "error.default");
            }
            this.updateShape(shape, false);
            this.shouldRegenerateShape = false;
        }
        return this._shape;
    }

    constructor(document: IDocument, body: IParameterBody, materialId?: string) {
        super(document, materialId);
        this.body = body;
        this.body.clearPropertyChanged();
        this.body.onPropertyChanged(this.onParameterChanged);
    }

    private onParameterChanged = () => {
        this.shouldRegenerateShape = true;
        this.emitPropertyChanged("shape", this._shape);
    };
}
