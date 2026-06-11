// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, FaceMeshData, IDisposable, IShape, VertexMeshData } from "@chili3d/core";
import { ClassicPreset } from "rete";
import type { Control, Socket } from "rete/_types/presets/classic";
import { flatTree } from "../../tree";
import type { INodeEditor } from "../../types";

export abstract class GeometryBaseNode<
        Inputs extends {
            [key in string]?: Socket;
        } = {
            [key in string]?: Socket;
        },
        Outputs extends {
            [key in string]?: Socket;
        } = {
            [key in string]?: Socket;
        },
        Controls extends {
            [key in string]?: Control;
        } = {
            [key in string]?: Control;
        },
    >
    extends ClassicPreset.Node<Inputs, Outputs, Controls>
    implements IDisposable
{
    protected visualId?: number;

    private _visibility = true;
    get visibility() {
        return this._visibility;
    }
    set visibility(value: boolean) {
        this._visibility = value;
        this.editor.process();
    }

    constructor(
        readonly editor: INodeEditor,
        name: string,
    ) {
        super(name);
    }

    abstract createShape(inputs: any): IShape | IShape[];

    data(inputs: any): { value: IShape | IShape[] } {
        const shapes = this.createShape(inputs);

        this.updateVisual(shapes);

        return {
            value: shapes,
        };
    }

    dispose(): void {
        this.removeVisual();
    }

    mesh(inputs: IShape[]): (VertexMeshData | EdgeMeshData | FaceMeshData)[] {
        return inputs.map((shape) => {
            const mesh = shape.mesh;
            if (mesh.faces && mesh.faces.position.length > 0) {
                return mesh.faces;
            } else if (mesh.edges && mesh.edges.position.length > 0) {
                return mesh.edges;
            } else {
                return mesh.vertexs!;
            }
        });
    }

    updateVisual(inputs: IShape | IShape[]) {
        this.removeVisual();

        if (this._visibility) {
            const shapes = flatTree(inputs);
            const mesh = this.mesh(shapes);

            if (mesh.length > 0) {
                this.visualId = this.editor.document.visual.context.displayMesh(mesh, {
                    meshOpacity: 0.8,
                });
            }
        }
    }

    private removeVisual() {
        if (this.visualId) {
            this.editor.document.visual.context.removeMesh(this.visualId);
            this.visualId = undefined;
        }
    }
}
