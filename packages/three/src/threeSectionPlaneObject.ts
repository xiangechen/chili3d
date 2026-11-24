// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    defaultFontService,
    type IShape,
    type ISubShape,
    type Matrix4,
    Plane,
    type SectionPlaneNode,
    type ShapeMeshRange,
    type ShapeType,
    type XYZ,
} from "@chili3d/core";
import {
    BufferAttribute,
    BufferGeometry,
    type Camera,
    DoubleSide,
    type InterleavedBufferAttribute,
    Mesh,
    MeshBasicMaterial,
    Matrix4 as ThreeMatrix4,
    Vector3,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { IHighlightable } from "./highlightable";
import { hilightEdgeMaterial } from "./materials";
import { TopRenderOrder } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { ThreeVisualObject } from "./threeVisualObject";

export interface SectionFrameLayout {
    center: XYZ;
    width: number;
    height: number;
}

function cameraFacingPlane(plane: Plane, camera?: Camera): Plane {
    if (!camera) return plane;
    const toCamera = camera.getWorldPosition(new Vector3()).sub(ThreeHelper.fromXYZ(plane.origin));
    if (toCamera.dot(ThreeHelper.fromXYZ(plane.normal)) >= 0) return plane;
    return new Plane({ origin: plane.origin, normal: plane.normal.reverse(), xvec: plane.xvec });
}

export class ThreeSectionPlaneObject extends ThreeVisualObject implements IHighlightable {
    private readonly frameMaterial = new LineMaterial({
        color: 0x0000ee,
        linewidth: 1.5,
        depthTest: false,
        depthWrite: false,
    });
    private readonly highlightMaterial = hilightEdgeMaterial.clone();
    private readonly frame: LineSegments2;
    private readonly labelMaterial = new MeshBasicMaterial({
        color: 0x0000ee,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
    });
    private readonly label: Mesh<BufferGeometry, MeshBasicMaterial>;
    private labelPlane?: Plane;
    private labelLayout?: SectionFrameLayout;

    constructor(readonly sectionNode: SectionPlaneNode) {
        super(sectionNode);
        this.name = "sectionPlane";
        this.highlightMaterial.depthTest = false;
        this.highlightMaterial.depthWrite = false;
        this.frame = new LineSegments2(new LineSegmentsGeometry(), this.frameMaterial);
        this.frame.name = "sectionPlaneFrame";
        this.frame.renderOrder = TopRenderOrder;
        this.frame.visible = false;
        this.label = new Mesh(new BufferGeometry(), this.labelMaterial);
        this.label.name = "sectionPlaneLabel";
        this.label.renderOrder = TopRenderOrder;
        this.label.visible = false;
        this.add(this.frame, this.label);
        sectionNode.onPropertyChanged(this.handleSectionNodeChanged);
        defaultFontService.onLoaded(this.handleFontLoaded);
        defaultFontService.ensureLoaded();
        this.rebuildLabel();
    }

    private readonly handleSectionNodeChanged = (property: keyof SectionPlaneNode) => {
        if (property !== "name") return;
        this.rebuildLabel();
        this.updateViews();
    };

    private readonly handleFontLoaded = () => {
        this.rebuildLabel();
        this.updateViews();
    };

    private updateViews(): void {
        this.sectionNode.document.application?.views?.forEach((view) => {
            view.update();
        });
    }

    private rebuildLabel(): void {
        const layout = defaultFontService.layout(this.sectionNode.name);
        let minX = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < layout.length; i += 2) {
            minX = Math.min(minX, layout[i]);
            maxY = Math.max(maxY, layout[i + 1]);
        }
        const positions = new Float32Array((layout.length / 2) * 3);
        for (let i = 0, j = 0; i < layout.length; i += 2) {
            positions[j++] = layout[i] - minX;
            positions[j++] = layout[i + 1] - maxY;
            positions[j++] = 0;
        }
        this.label.geometry.dispose();
        this.label.geometry = new BufferGeometry();
        if (positions.length > 0) {
            this.label.geometry.setAttribute("position", new BufferAttribute(positions, 3));
            this.label.geometry.computeBoundingBox();
            this.label.geometry.computeBoundingSphere();
        }
        this.updateLabelTransform();
    }

    private updateLabelTransform(): void {
        const plane = this.labelPlane;
        const layout = this.labelLayout;
        if (!plane || !layout) return;
        const textHeight = Math.min(layout.width, layout.height) * 0.05;
        const padding = textHeight * 0.4;
        const corner = layout.center
            .sub(plane.xvec.multiply(layout.width / 2 - padding))
            .add(plane.yvec.multiply(layout.height / 2 - padding));
        this.label.position.set(corner.x, corner.y, corner.z);
        this.label.quaternion.setFromRotationMatrix(
            new ThreeMatrix4().makeBasis(
                ThreeHelper.fromXYZ(plane.xvec),
                ThreeHelper.fromXYZ(plane.yvec),
                ThreeHelper.fromXYZ(plane.normal),
            ),
        );
        this.label.scale.setScalar(textHeight);
        this.label.visible = this.frame.visible && this.label.geometry.hasAttribute("position");
    }

    updateFrame(plane: Plane, layout: SectionFrameLayout, camera?: Camera): void {
        const x = plane.xvec.multiply(layout.width / 2);
        const y = plane.yvec.multiply(layout.height / 2);
        const corners = [
            layout.center.sub(x).sub(y),
            layout.center.add(x).sub(y),
            layout.center.add(x).add(y),
            layout.center.sub(x).add(y),
        ];
        const positions: number[] = [];
        for (let i = 0; i < corners.length; i++) {
            positions.push(...corners[i].toArray(), ...corners[(i + 1) % corners.length].toArray());
        }
        const instanceStart = this.frame.geometry.getAttribute("instanceStart") as
            | InterleavedBufferAttribute
            | undefined;
        if (instanceStart?.data.array.length === positions.length) {
            instanceStart.data.array.set(positions);
            instanceStart.data.needsUpdate = true;
        } else {
            this.frame.geometry.setPositions(positions);
        }
        this.frame.geometry.computeBoundingBox();
        this.frame.geometry.computeBoundingSphere();
        this.frame.visible = true;
        this.labelPlane = cameraFacingPlane(plane, camera);
        this.labelLayout = layout;
        this.updateLabelTransform();
    }

    highlight(): void {
        this.frame.material = this.highlightMaterial;
    }

    unhighlight(): void {
        this.frame.material = this.frameMaterial;
    }

    getSubShapeAndIndex(): {
        shape: IShape | undefined;
        subShape: ISubShape | undefined;
        index: number;
        transform?: Matrix4;
        groups: ShapeMeshRange[];
    } {
        return { shape: undefined, subShape: undefined, index: -1, groups: [] };
    }

    subShapeVisual(_shapeType: ShapeType): [] {
        return [];
    }

    wholeVisual(): LineSegments2[] {
        return [this.frame];
    }

    override dispose(): void {
        this.sectionNode.removePropertyChanged(this.handleSectionNodeChanged);
        defaultFontService.removeLoaded(this.handleFontLoaded);
        this.label.geometry.dispose();
        this.labelMaterial.dispose();
        this.frame.geometry.dispose();
        this.frameMaterial.dispose();
        this.highlightMaterial.dispose();
        super.dispose();
    }
}
