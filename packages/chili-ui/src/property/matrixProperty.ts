// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GroupNode, IConverter, IDocument, Matrix4, Result, VisualNode, XYZLike } from "chili-core";
import { InputProperty } from "./input";
import { PropertyBase } from "./propertyBase";

export class MatrixProperty extends PropertyBase {
    readonly first: VisualNode | GroupNode;

    constructor(
        readonly document: IDocument,
        geometries: (VisualNode | GroupNode)[],
        className: string,
    ) {
        super(geometries);
        this.first = geometries[0];
        this.className = className;
        this.append(
            new InputProperty(
                document,
                [this.first],
                {
                    name: "transform",
                    display: "transform.translation",
                },
                new TranslationConverter(this.first),
            ),
            new InputProperty(
                document,
                [this.first],
                {
                    name: "transform",
                    display: "transform.scale",
                },
                new ScalingConverter(this.first),
            ),
            new InputProperty(
                document,
                [this.first],
                {
                    name: "transform",
                    display: "transform.rotation",
                },
                new RotateConverter(this.first),
            ),
        );
    }

    private readonly onPropertyChanged = (property: keyof (VisualNode | GroupNode)) => {
        if (property === "transform") {
            this.objects.forEach((obj) => {
                if (obj === this.first) return;
                obj.transform = this.first.transform;
            });
        }
    };

    connectedCallback() {
        (this.first as VisualNode).onPropertyChanged(this.onPropertyChanged);
    }

    disconnectedCallback() {
        (this.first as VisualNode).removePropertyChanged(this.onPropertyChanged);
    }
}

customElements.define("matrix-property", MatrixProperty);

export abstract class MatrixConverter implements IConverter<Matrix4, string> {
    constructor(readonly geometry: VisualNode | GroupNode) {}

    convert(value: Matrix4): Result<string, string> {
        const [x, y, z] = this.convertFrom(value);
        return Result.ok(`${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)}`);
    }

    protected abstract convertFrom(value: Matrix4): [number, number, number];
    protected abstract convertTo(values: XYZLike): Matrix4;

    convertBack(value: string): Result<Matrix4, string> {
        const values = value
            .split(",")
            .map(Number)
            .filter((x) => !isNaN(x));
        if (values.length !== 3) return Result.err("invalid number of values");
        const newValue = {
            x: values[0],
            y: values[1],
            z: values[2],
        };
        const matrix = this.convertTo(newValue);
        return Result.ok(matrix);
    }
}

export class TranslationConverter extends MatrixConverter {
    protected convertFrom(matrix: Matrix4): [number, number, number] {
        let position = matrix.translationPart();
        return [position.x, position.y, position.z];
    }
    protected convertTo(values: XYZLike): Matrix4 {
        const rotation = this.geometry.transform.getEulerAngles();
        const scale = this.geometry.transform.getScale();
        return Matrix4.createFromTRS(values, rotation, scale);
    }
}

export class ScalingConverter extends MatrixConverter {
    protected convertFrom(matrix: Matrix4): [number, number, number] {
        let s = matrix.getScale();
        return [s.x, s.y, s.z];
    }
    protected convertTo(values: XYZLike): Matrix4 {
        const rotation = this.geometry.transform.getEulerAngles();
        const translation = this.geometry.transform.translationPart();
        return Matrix4.createFromTRS(translation, rotation, values);
    }
}

export class RotateConverter extends MatrixConverter {
    protected convertFrom(matrix: Matrix4): [number, number, number] {
        let s = matrix.getEulerAngles();
        return [(s.pitch * 180) / Math.PI, (s.yaw * 180) / Math.PI, (s.roll * 180) / Math.PI];
    }
    protected convertTo(values: XYZLike): Matrix4 {
        const scale = this.geometry.transform.getScale();
        const translation = this.geometry.transform.translationPart();
        return Matrix4.createFromTRS(
            translation,
            {
                pitch: (values.x * Math.PI) / 180,
                yaw: (values.y * Math.PI) / 180,
                roll: (values.z * Math.PI) / 180,
            },
            scale,
        );
    }
}
