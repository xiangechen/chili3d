// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export class Loading extends HTMLElement {
    constructor() {
        super();
        this.initSpinner();
        this.initLabel();
        this.initAnimation();
        this.style.cssText = `
            position: fixed;
            display: block;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 9999;
            background-color: rgba(0, 0, 0, 0.5);
        `;
    }

    private initSpinner() {
        let text = document.createElement("div");
        text.style.cssText = `
            position: absolute;
            top: 40%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 5px solid #fff;
            border-top-color: #000;
            animation: spin 1s infinite linear;
        `;
        this.appendChild(text);
    }

    private initAnimation() {
        let styleSheet = document.createElement("style");
        styleSheet.innerHTML = `
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(styleSheet);
    }

    private initLabel() {
        let text = document.createElement("div");
        text.innerText = "Loading...";
        text.style.cssText = `
        color: white;
        font-size: 16px;
        position: relative;
        top: calc(40% + 100px);
        left: calc(50% + 25px);
        transform: translate(-50%, -50%);
        width: 50px;
        height: 50px;
        `;
        this.appendChild(text);
    }
}

customElements.define("chili-loading", Loading);
