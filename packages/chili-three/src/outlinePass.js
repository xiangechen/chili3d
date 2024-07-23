/**
 * This is a forked and simplified version of the OutlinePass from three.js. In order to improve performance, various
 * features have been deleted. This is about 2x faster.
 */
import {
    AdditiveBlending,
    Color,
    DoubleSide,
    LinearFilter,
    Matrix4,
    MeshBasicMaterial,
    MeshDepthMaterial,
    NoBlending,
    RGBADepthPacking,
    RGBAFormat,
    ShaderMaterial,
    UniformsUtils,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";

class OutlinePass extends Pass {
    constructor(scene, camera) {
        super();

        this.renderScene = scene;
        this.renderCamera = camera;
        this.visibleEdgeColor = new Color(1, 1, 1);
        this.hiddenEdgeColor = new Color(0.1, 0.04, 0.02);
        this.usePatternTexture = false;
        this.edgeStrength = 3.0;
        this.pulsePeriod = 0;

        this._visibilityCache = new Map();

        this.resolution = new Vector2(256, 256);

        const pars = {
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            format: RGBAFormat,
            skipInvalidateFramebuffer: true,
        };

        this.maskBufferMaterial = new MeshBasicMaterial({ color: 0xffffff });
        this.maskBufferMaterial.side = DoubleSide;
        this.renderTargetMaskBuffer = new WebGLRenderTarget(this.resolution.x, this.resolution.y, pars);
        this.renderTargetMaskBuffer.texture.name = "OutlinePass.mask";
        this.renderTargetMaskBuffer.texture.generateMipmaps = false;

        this.depthMaterial = new MeshDepthMaterial();
        this.depthMaterial.side = DoubleSide;
        this.depthMaterial.depthPacking = RGBADepthPacking;
        this.depthMaterial.blending = NoBlending;

        this.prepareMaskMaterial = this.getPrepareMaskMaterial();
        this.prepareMaskMaterial.side = DoubleSide;
        this.prepareMaskMaterial.fragmentShader = replaceDepthToViewZ(
            this.prepareMaskMaterial.fragmentShader,
            this.renderCamera,
        );

        this.renderTargetDepthBuffer = new WebGLRenderTarget(this.resolution.x, this.resolution.y, pars);
        this.renderTargetDepthBuffer.texture.name = "OutlinePass.depth";
        this.renderTargetDepthBuffer.texture.generateMipmaps = false;

        this.edgeDetectionMaterial = this.getEdgeDetectionMaterial();
        this.renderTargetEdgeBuffer1 = new WebGLRenderTarget(this.resolution.x, this.resolution.y, pars);
        this.renderTargetEdgeBuffer1.texture.name = "OutlinePass.edge1";
        this.renderTargetEdgeBuffer1.texture.generateMipmaps = false;

        // Overlay material
        this.overlayMaterial = this.getOverlayMaterial();

        // copy material
        if (CopyShader === undefined) console.error("THREE.OutlinePass relies on CopyShader");

        const copyShader = CopyShader;

        this.copyUniforms = UniformsUtils.clone(copyShader.uniforms);
        this.copyUniforms["opacity"].value = 1.0;

        this.materialCopy = new ShaderMaterial({
            uniforms: this.copyUniforms,
            vertexShader: copyShader.vertexShader,
            fragmentShader: copyShader.fragmentShader,
            blending: NoBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });

        this.enabled = true;
        this.needsSwap = false;

        this._oldClearColor = new Color();
        this.oldClearAlpha = 1;

        this.fsQuad = new FullScreenQuad(null);

        this.tempPulseColor1 = new Color();
        this.tempPulseColor2 = new Color();
        this.textureMatrix = new Matrix4();

        function replaceDepthToViewZ(string, camera) {
            var type = camera.isPerspectiveCamera ? "perspective" : "orthographic";

            return string.replace(/DEPTH_TO_VIEW_Z/g, type + "DepthToViewZ");
        }
    }

    dispose() {
        this.renderTargetMaskBuffer.dispose();
        this.renderTargetDepthBuffer.dispose();
        this.renderTargetEdgeBuffer1.dispose();
    }

    setSize(width, height) {
        this.renderTargetMaskBuffer.setSize(width, height);
        this.renderTargetDepthBuffer.setSize(width, height);

        this.renderTargetEdgeBuffer1.setSize(width, height);
    }

    updateTextureMatrix() {
        this.textureMatrix.set(
            0.5,
            0.0,
            0.0,
            0.5,
            0.0,
            0.5,
            0.0,
            0.5,
            0.0,
            0.0,
            0.5,
            0.5,
            0.0,
            0.0,
            0.0,
            1.0,
        );
        this.textureMatrix.multiply(this.renderCamera.projectionMatrix);
        this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse);
    }

    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        if (this.renderScene.children.length > 0) {
            renderer.getClearColor(this._oldClearColor);
            this.oldClearAlpha = renderer.getClearAlpha();
            const oldAutoClear = renderer.autoClear;

            renderer.autoClear = false;

            if (maskActive) renderer.state.buffers.stencil.setTest(false);

            renderer.setClearColor(0xffffff, 1);

            // Update Texture Matrix for Depth compare
            this.updateTextureMatrix();

            this.renderScene.overrideMaterial = this.prepareMaskMaterial;
            this.prepareMaskMaterial.uniforms["cameraNearFar"].value.set(
                this.renderCamera.near,
                this.renderCamera.far,
            );
            this.prepareMaskMaterial.uniforms["depthTexture"].value = this.renderTargetDepthBuffer.texture;
            this.prepareMaskMaterial.uniforms["textureMatrix"].value = this.textureMatrix;
            renderer.setRenderTarget(this.renderTargetMaskBuffer);
            renderer.clear();
            renderer.render(this.renderScene, this.renderCamera);
            this.renderScene.overrideMaterial = null;

            this.tempPulseColor1.copy(this.visibleEdgeColor);
            this.tempPulseColor2.copy(this.hiddenEdgeColor);

            // 3. Apply Edge Detection Pass
            this.fsQuad.material = this.edgeDetectionMaterial;
            this.edgeDetectionMaterial.uniforms["maskTexture"].value = this.renderTargetMaskBuffer.texture;
            this.edgeDetectionMaterial.uniforms["texSize"].value.set(
                this.renderTargetMaskBuffer.width,
                this.renderTargetMaskBuffer.height,
            );
            this.edgeDetectionMaterial.uniforms["visibleEdgeColor"].value = this.tempPulseColor1;
            this.edgeDetectionMaterial.uniforms["hiddenEdgeColor"].value = this.tempPulseColor2;
            renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
            renderer.clear();
            this.fsQuad.render(renderer);

            // Blend it additively over the input texture
            this.fsQuad.material = this.overlayMaterial;
            this.overlayMaterial.uniforms["maskTexture"].value = this.renderTargetMaskBuffer.texture;
            this.overlayMaterial.uniforms["edgeTexture1"].value = this.renderTargetEdgeBuffer1.texture;
            this.overlayMaterial.uniforms["edgeStrength"].value = this.edgeStrength;

            if (maskActive) renderer.state.buffers.stencil.setTest(true);

            renderer.setRenderTarget(readBuffer);
            this.fsQuad.render(renderer);

            renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
            renderer.autoClear = oldAutoClear;
        }

        if (this.renderToScreen) {
            this.fsQuad.material = this.materialCopy;
            this.copyUniforms["tDiffuse"].value = readBuffer.texture;
            renderer.setRenderTarget(null);
            this.fsQuad.render(renderer);
        }
    }

    getPrepareMaskMaterial() {
        const result = new ShaderMaterial({
            uniforms: {
                depthTexture: { value: null },
                cameraNearFar: { value: new Vector2(0.5, 0.5) },
                textureMatrix: { value: null },
                id: { value: null },
            },

            vertexShader: `#include <morphtarget_pars_vertex>
				#include <skinning_pars_vertex>
				varying vec4 projTexCoord;
				varying vec4 vPosition;
				uniform mat4 textureMatrix;
				void main() {
					#include <skinbase_vertex>
					#include <begin_vertex>
					#include <morphtarget_vertex>
					#include <skinning_vertex>
					#include <project_vertex>
					vPosition = mvPosition;
					vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
					projTexCoord = textureMatrix * worldPosition;
				}`,

            fragmentShader: `#include <packing>
				varying vec4 vPosition;
				varying vec4 projTexCoord;
				uniform sampler2D depthTexture;
				uniform vec2 cameraNearFar;
                uniform float id;
				void main() {
					float depth = unpackRGBAToDepth(texture2DProj( depthTexture, projTexCoord ));
					float viewZ = - DEPTH_TO_VIEW_Z( depth, cameraNearFar.x, cameraNearFar.y );
					float depthTest = (-vPosition.z > viewZ) ? 1.0 : 0.0;
					gl_FragColor = vec4(id/255.0, depthTest, 1.0, 1.0);
				}`,
        });

        let idCounter = 0;
        result.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
            result.uniforms.id.value = idCounter;
            result.uniformsNeedUpdate = true;
            idCounter += 100;
            idCounter %= 255;
        };
        return result;
    }

    getEdgeDetectionMaterial() {
        return new ShaderMaterial({
            uniforms: {
                maskTexture: { value: null },
                texSize: { value: new Vector2(0.5, 0.5) },
                visibleEdgeColor: { value: new Vector3(1.0, 1.0, 1.0) },
                hiddenEdgeColor: { value: new Vector3(1.0, 1.0, 1.0) },
            },

            vertexShader: `varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,

            fragmentShader: `varying vec2 vUv;
				uniform sampler2D maskTexture;
				uniform vec2 texSize;
				uniform vec3 visibleEdgeColor;
				uniform vec3 hiddenEdgeColor;
				void main() {
					vec2 invSize = 1. / texSize;
					vec4 uvOffset = vec4(1.0, 0.0, 0.0, 1.0) * vec4(invSize, invSize);
					vec4 c1 = texture2D( maskTexture, vUv + uvOffset.xy);
					vec4 c2 = texture2D( maskTexture, vUv - uvOffset.xy);
					vec4 c3 = texture2D( maskTexture, vUv + uvOffset.yw);
					vec4 c4 = texture2D( maskTexture, vUv - uvOffset.yw);
					float diff1 = (c1.r - c2.r)*0.5;
					float diff2 = (c3.r - c4.r)*0.5;
					float d = length( vec2(diff1, diff2) );
					float a1 = min(c1.g, c2.g);
					float a2 = min(c3.g, c4.g);
					float visibilityFactor = min(a1, a2);
					vec3 edgeColor = 1.0 - visibilityFactor > 0.001 ? visibleEdgeColor : hiddenEdgeColor;
					gl_FragColor = vec4(edgeColor, 1.0) * vec4(d > 0. ? 1. : 0.);
				}`,
        });
    }

    getOverlayMaterial() {
        return new ShaderMaterial({
            uniforms: {
                maskTexture: { value: null },
                edgeTexture1: { value: null },
                patternTexture: { value: null },
                edgeStrength: { value: 1.0 },
            },

            vertexShader: `varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,

            fragmentShader: `varying vec2 vUv;
				uniform sampler2D maskTexture;
				uniform sampler2D edgeTexture1;
				uniform sampler2D patternTexture;
				uniform float edgeStrength;
				void main() {
					vec4 edgeValue = texture2D(edgeTexture1, vUv);
					vec4 maskColor = texture2D(maskTexture, vUv);
					float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;
					vec4 finalColor = edgeStrength * edgeValue;
					gl_FragColor = finalColor;
				}`,
            blending: AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
    }
}

export { OutlinePass };
