// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IEqualityComparer, PubSub, Result } from "../foundation";
import { I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { IShape } from "../shape";
import { Entity } from "./entity";

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

    override onMatrixChanged(newMatrix: Matrix4, oldMatrix: Matrix4): void {
        if (this._shape.isOk) this._shape.value.matrix = newMatrix;
    }

    protected changeShape(shape: Result<IShape>, notify: boolean): boolean {
        if (shape.isOk && this._shape.isOk && this._shape.value.isEqual(shape.value)) {
            return false;
        }

        let oldShape = this._shape;
        this._shape = shape;
        if (this._shape.isOk) {
            this._shape.value.matrix = this._matrix;
        }
        if (notify) this.emitPropertyChanged("shape", oldShape);
        return true;
    }
}

@Serializer.register("EditableGeometryEntity", ["document", "editableShape", "materialId"])
export class EditableGeometryEntity extends GeometryEntity {
    override display: I18nKeys = "common.angle";

    @Serializer.serialze()
    get editableShape(): IShape {
        return this._shape.unwrap();
    }
    set editableShape(value: IShape) {
        this.changeShape(Result.ok(value), true);
    }

    constructor(document: IDocument, shape: IShape, materialId?: string) {
        super(document, materialId);
        this._shape = Result.ok(shape);
    }
}

export abstract class ParameterGeometry extends GeometryEntity {
    protected shouldRegenerateShape: boolean = true;
    override get shape(): Result<IShape> {
        if (this.shouldRegenerateShape) {
            this.changeShape(this.generateShape(), false);
            this.shouldRegenerateShape = false;
        }
        return this._shape;
    }

    protected setPropertyAndUpdate<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ) {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            let shape = this.generateShape();
            if (!shape.isOk) {
                PubSub.default.pub("showToast", "error.default");
                return;
            }
            this.changeShape(shape, true);
        }
    }

    protected abstract generateShape(): Result<IShape>;
}

export abstract class FaceableGeometry extends ParameterGeometry {
    protected _isFace: boolean = false;
    @Serializer.serialze()
    @Property.define("command.faceable.isFace")
    get isFace() {
        return this._isFace;
    }
    set isFace(value: boolean) {
        this.setPropertyAndUpdate("isFace", value);
    }
}
