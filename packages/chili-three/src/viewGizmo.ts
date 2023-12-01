// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Matrix4, Vector3 } from "three";
import { CameraController } from "./cameraController";
import { ThreeView } from "./threeView";

const options = {
    size: 200,
    padding: 16,
    bubbleSizePrimary: 18,
    bubbleSizeSeconday: 10,
    showSecondary: true,
    lineWidth: 2,
    fontSize: "24px",
    fontFamily: "arial",
    fontColor: "#151515",
    fontYAdjust: 0,
    colors: {
        x: ["#f73c3c", "#942424"],
        y: ["#6ccb26", "#417a17"],
        z: ["#178cf0", "#0e5490"],
    },
};

export interface Axis {
    axis: string;
    direction: Vector3;
    size: number;
    position: Vector3;
    color: string[];
    line?: number;
    label?: string;
}

export class ViewGizmo extends HTMLElement {
    readonly #axes: Axis[];
    readonly #center: Vector3;
    readonly #canvas: HTMLCanvasElement;
    readonly #context: CanvasRenderingContext2D;
    readonly cameraController: CameraController;
    #canClick: boolean = true;
    #selectedAxis?: Axis;
    #mouse?: Vector3;

    constructor(readonly view: ThreeView) {
        super();
        this.cameraController = view.cameraController;
        this.#axes = this.#initAxes();
        this.#center = new Vector3(options.size * 0.5, options.size * 0.5, 0);
        this.#canvas = this.#initCanvas();
        this.#context = this.#canvas.getContext("2d")!;
        this.#initStyle();
    }

    #initStyle() {
        this.style.position = "absolute";
        this.style.top = "20px";
        this.style.right = "20px";
        this.style.borderRadius = "100%";
        this.style.cursor = "pointer";
    }

    #initCanvas() {
        let canvas = document.createElement("canvas");
        canvas.width = options.size;
        canvas.height = options.size;
        canvas.style.width = `${options.size * 0.5}px`;
        canvas.style.height = `${options.size * 0.5}px`;
        this.append(canvas);
        return canvas;
    }

    #initAxes() {
        return [
            {
                axis: "x",
                direction: new Vector3(1, 0, 0),
                position: new Vector3(),
                size: options.bubbleSizePrimary,
                color: options.colors.x,
                line: options.lineWidth,
                label: "X",
            },
            {
                axis: "y",
                direction: new Vector3(0, 1, 0),
                position: new Vector3(),
                size: options.bubbleSizePrimary,
                color: options.colors.y,
                line: options.lineWidth,
                label: "Y",
            },
            {
                axis: "z",
                direction: new Vector3(0, 0, 1),
                position: new Vector3(),
                size: options.bubbleSizePrimary,
                color: options.colors.z,
                line: options.lineWidth,
                label: "Z",
            },
            {
                axis: "-x",
                direction: new Vector3(-1, 0, 0),
                position: new Vector3(),
                size: options.bubbleSizeSeconday,
                color: options.colors.x,
            },
            {
                axis: "-y",
                direction: new Vector3(0, -1, 0),
                position: new Vector3(),
                size: options.bubbleSizeSeconday,
                color: options.colors.y,
            },
            {
                axis: "-z",
                direction: new Vector3(0, 0, -1),
                position: new Vector3(),
                size: options.bubbleSizeSeconday,
                color: options.colors.z,
            },
        ];
    }

    connectedCallback() {
        this.#canvas.addEventListener("pointermove", this.#onPointerMove, false);
        this.#canvas.addEventListener("pointerenter", this.#onPointerEnter, false);
        this.#canvas.addEventListener("pointerout", this.#onPointerOut, false);
        this.#canvas.addEventListener("click", this.#onClick, false);
    }

    disconnectedCallback() {
        this.#canvas.removeEventListener("pointermove", this.#onPointerMove, false);
        this.#canvas.removeEventListener("pointerenter", this.#onPointerEnter, false);
        this.#canvas.removeEventListener("pointerout", this.#onPointerOut, false);
        this.#canvas.removeEventListener("click", this.#onClick, false);
    }

    #onPointerMove = (e: PointerEvent) => {
        e.stopPropagation();
        if (e.buttons === 1 && !(e.movementX === 0 && e.movementY === 0)) {
            this.cameraController.rotate(e.movementX * 4, e.movementY * 4);
            this.#canClick = false;
        }
        const rect = this.#canvas.getBoundingClientRect();
        this.#mouse = new Vector3(e.clientX - rect.left, e.clientY - rect.top, 0).multiplyScalar(2);
        this.view.update();
    };

    #onPointerOut = (e: PointerEvent) => {
        this.#mouse = undefined;
        this.style.backgroundColor = "transparent";
    };

    #onPointerEnter = (e: PointerEvent) => {
        this.style.backgroundColor = "rgba(255, 255, 255, .2)";
    };

    #onClick = (e: MouseEvent) => {
        if (!this.#canClick) {
            this.#canClick = true;
            return;
        }
        if (this.#selectedAxis) {
            let distance = this.cameraController.camera.position.distanceTo(this.cameraController.target);
            let position = this.#selectedAxis.direction
                .clone()
                .multiplyScalar(distance)
                .add(this.cameraController.target);
            this.cameraController.camera.position.copy(position);
            let up = new Vector3(0, 0, 1);
            if (this.#selectedAxis.axis === "z") up = new Vector3(0, 1, 0);
            else if (this.#selectedAxis.axis === "-z") up = new Vector3(0, -1, 0);
            this.cameraController.camera.up.copy(up);
            this.cameraController.camera.lookAt(this.cameraController.target);
        }
    };

    clear() {
        this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    }

    update() {
        this.clear();
        let invRotMat = new Matrix4().makeRotationFromEuler(this.cameraController.camera.rotation).invert();
        this.#axes.forEach(
            (axis) =>
                (axis.position = this.getBubblePosition(axis.direction.clone().applyMatrix4(invRotMat))),
        );
        this.#axes.sort((a, b) => a.position.z - b.position.z);
        this.setSelectedAxis(this.#axes);
        this.drawAxes(this.#axes);
    }

    private setSelectedAxis(axes: Axis[]) {
        this.#selectedAxis = undefined;
        if (this.#mouse && this.#canClick) {
            let closestDist = Infinity;
            for (let axis of axes) {
                const distance = this.#mouse.distanceTo(axis.position);
                if (distance < closestDist && distance < axis.size) {
                    closestDist = distance;
                    this.#selectedAxis = axis;
                }
            }
        }
    }

    drawAxes(axes: Axis[]) {
        for (let axis of axes) {
            let color = this.getAxisColor(axis);
            this.drawCircle(axis.position, axis.size, color);
            this.drawLine(this.#center, axis.position, color, axis.line);
            this.drawLabel(axis);
        }
    }

    private getAxisColor(axis: Axis) {
        let color;
        if (this.#selectedAxis === axis) {
            color = "#FFFFFF";
        } else if (axis.position.z >= -0.01) {
            color = axis.color[0];
        } else {
            color = axis.color[1];
        }
        return color;
    }

    private drawCircle(p: Vector3, radius = 10, color = "#FF0000") {
        this.#context.beginPath();
        this.#context.arc(p.x, p.y, radius, 0, 2 * Math.PI, false);
        this.#context.fillStyle = color;
        this.#context.fill();
        this.#context.closePath();
    }

    private drawLine(p1: Vector3, p2: Vector3, color: string, width?: number) {
        if (width) {
            this.#context.beginPath();
            this.#context.moveTo(p1.x, p1.y);
            this.#context.lineTo(p2.x, p2.y);
            this.#context.lineWidth = width;
            this.#context.strokeStyle = color;
            this.#context.stroke();
            this.#context.closePath();
        }
    }

    private drawLabel(axis: Axis) {
        if (axis.label) {
            this.#context.font = [options.fontSize, options.fontFamily].join(" ");
            this.#context.fillStyle = options.fontColor;
            this.#context.textBaseline = "middle";
            this.#context.textAlign = "center";
            this.#context.fillText(axis.label, axis.position.x, axis.position.y + options.fontYAdjust);
        }
    }

    private getBubblePosition(vector: Vector3) {
        return new Vector3(
            vector.x * (this.#center.x - options.bubbleSizePrimary / 2 - options.padding) + this.#center.x,
            this.#center.y - vector.y * (this.#center.y - options.bubbleSizePrimary / 2 - options.padding),
            vector.z,
        );
    }
}

customElements.define("view-gizmo", ViewGizmo);
