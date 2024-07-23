// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Camera, Color, RepeatWrapping, Scene, Texture, TextureLoader, WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader";
import { OutlinePass } from "./outlinePass";
import texture_points from "./texture_points.jpg";

export class ThreeRenderBuilder {
    readonly renderer: WebGLRenderer;
    readonly composer: EffectComposer;
    private patternTexture: Texture | undefined;

    constructor(
        readonly scene: Scene,
        readonly camera: Camera,
    ) {
        this.renderer = this.initRenderer();
        this.composer = this.initComposer();

        const renderPass = new RenderPass(scene, camera);
        this.composer.addPass(renderPass);
    }

    private initRenderer() {
        let renderer = new WebGLRenderer({
            antialias: false,
            alpha: true,
        });
        renderer.setPixelRatio(window.devicePixelRatio);

        return renderer;
    }

    private initComposer() {
        let composer = new EffectComposer(this.renderer);
        composer.setPixelRatio(window.devicePixelRatio);
        return composer;
    }

    addOutlinePass(scene: Scene, color: number, usePatternTexture: boolean) {
        const outlinePass = new OutlinePass(scene, this.camera);
        outlinePass.visibleEdgeColor = new Color(color).convertSRGBToLinear();
        outlinePass.hiddenEdgeColor = new Color(color).convertSRGBToLinear();
        outlinePass.edgeStrength = 5;
        this.composer.addPass(outlinePass);

        return this;
    }

    addGammaCorrection() {
        const gammaCorrection = new ShaderPass(GammaCorrectionShader);
        this.composer.addPass(gammaCorrection);
        return this;
    }

    build(): [WebGLRenderer, EffectComposer] {
        return [this.renderer, this.composer];
    }

    private loadPatternTexture(callback: (texture: Texture) => void) {
        if (this.patternTexture) {
            callback(this.patternTexture);
        }

        const textureLoader = new TextureLoader();
        textureLoader.load(texture_points, (texture) => {
            texture.wrapS = RepeatWrapping;
            texture.wrapT = RepeatWrapping;
            this.patternTexture = texture;

            callback(texture);
        });
    }
}
