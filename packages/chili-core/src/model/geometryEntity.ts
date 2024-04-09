// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IEqualityComparer, Result } from "../foundation";
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

    protected shouldRegenerate: boolean = true;

    protected _shape: Result<IShape> = Result.err("Not initialised");
    get shape(): Result<IShape> {
        if (this.shouldRegenerate) {
            this._shape = this.generateShape();
            if (this._shape.isOk) {
                this._shape.value.matrix = this._matrix;
            }
            this.shouldRegenerate = false;
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
            this.shouldRegenerate = true;
            this.emitShapeChanged();
        }
    }

    constructor(document: IDocument, materialId?: string) {
        super(document);
        this._materialId = materialId ?? document.materials.at(0)!.id;
    }

    protected emitShapeChanged() {
        this.emitPropertyChanged("shape", this._shape);
    }

    override onMatrixChanged(newMatrix: Matrix4, oldMatrix: Matrix4): void {
        if (this.shape.isOk) {
            this.shape.value.matrix = newMatrix;
        }
    }

    protected abstract generateShape(): Result<IShape>;
}

/*
export abstract class HistoryBody extends Body {
    private readonly _features: Feature[] = [];

    private onShapeChanged = (entity: Entity) => {
        if (entity === this) {
            this.drawShape();
        } else {
            let editor = entity as Feature;
            let i = this._features.indexOf(editor);
            this.applyFeatures(i);
        }
        this.redrawModel();
    };

    drawShape() {
        this.applyFeatures(0);
    }
    
    private applyFeatures(startIndex: number) {
        if (startIndex < 0) return;
        for (let i = startIndex; i < this._features.length; i++) {
            this._shape = this._features[i].shape;
            if (!this._shape.isOk) {
                return;
            }
        }
        if (this._shape) {
            this._shape.matrix = this._matrix;
        }
    }

    removeFeature(feature: Feature) {
        const index = this._features.indexOf(feature, 0);
        if (index > -1) {
            this._features.splice(index, 1);
            feature.removeShapeChanged(this.onShapeChanged);
            this._features[index].origin =
                index === 0 ? this.body.shape.unwrap() : this._features[index - 1].shape.unwrap(); // todo
            this.applyFeatures(index);
            this.redrawModel();
        }
    }

    addFeature(feature: Feature) {
        if (this._features.indexOf(feature) > -1) return;
        this._features.push(feature);
        feature.onShapeChanged(this.onShapeChanged);
        if (this._shape !== undefined) {
            feature.origin = this._shape;
            this.applyFeatures(this._features.length - 1);
            this.redrawModel();
        }
    }

    getFeature(index: number) {
        if (index < this._features.length) {
            return this._features[index];
        }
        return undefined;
    }

    features() {
        return [...this._features];
    }
}
*/

export abstract class FaceableGeometry extends GeometryEntity {
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
