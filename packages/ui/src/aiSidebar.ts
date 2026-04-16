// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Optional add-on: a right-side panel that hosts the @chili3d/ai-chat
// iframe. Off by default — to enable, run in the browser console:
//
//     localStorage.setItem("chili3d.aiChat.enabled", "true"); location.reload();
//
// When enabled, the iframe loads /chat/ (built and copied into dist/ by the
// chat package's Vite build via the existing Rspack CopyRspackPlugin), with
// a toggle button in the top-right of the viewport.

import { div } from "@chili3d/element";
import style from "./aiSidebar.module.css";

const ENABLED_KEY = "chili3d.aiChat.enabled";
const STATE_KEY = "chili3d.aiSidebar";
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 260;

export function isAiChatEnabled(): boolean {
    try {
        return localStorage.getItem(ENABLED_KEY) === "true";
    } catch {
        return false;
    }
}

interface AttachOptions {
    contentRow: HTMLElement;
    viewportContainer: HTMLElement;
    mainWindow: HTMLElement | undefined;
}

export function attachAiSidebar(opts: AttachOptions): void {
    if (!isAiChatEnabled()) return;

    const state = loadState();
    let width = state.width;
    let visible = state.visible;
    let resizing = false;

    const iframe = document.createElement("iframe");
    iframe.className = style.aiIframe;
    iframe.src = "/chat/";
    iframe.title = "AI Assistant";

    const sidebar = div(
        { className: style.aiSidebar, style: `width: ${width}px;` },
        div({ className: style.aiSidebarResizer, onmousedown: startResize }),
        iframe,
    );

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = style.aiToggle;
    toggle.title = "Toggle AI assistant";
    toggle.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l2.2 5.8 5.8 2.2-5.8 2.2L12 18.5l-2.2-5.8L4 10.5l5.8-2.2L12 2.5z"/>
        <path d="M18.5 14l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2z" opacity="0.7"/>
    </svg>`;
    toggle.onclick = () => {
        visible = !visible;
        applyVisibility();
        saveState({ width, visible });
    };

    opts.contentRow.appendChild(sidebar);
    opts.viewportContainer.appendChild(toggle);
    applyVisibility();

    function applyVisibility() {
        sidebar.style.display = visible ? "" : "none";
        toggle.classList.toggle(style.aiToggleActive, visible);
    }

    function startResize(e: MouseEvent) {
        e.preventDefault();
        resizing = true;
        if (opts.mainWindow) opts.mainWindow.style.cursor = "ew-resize";
        // Pointer-events overlay so mousemove isn't swallowed by the iframe.
        const overlay = div({ className: style.aiIframeOverlay });
        sidebar.appendChild(overlay);
        const onMove = (ev: MouseEvent) => {
            if (!resizing) return;
            const rect = sidebar.getBoundingClientRect();
            let next = rect.right - ev.clientX;
            const max = Math.floor(window.innerWidth * 0.6);
            next = Math.max(MIN_WIDTH, Math.min(max, next));
            width = next;
            sidebar.style.width = `${width}px`;
        };
        const onUp = () => {
            resizing = false;
            if (opts.mainWindow) opts.mainWindow.style.cursor = "";
            overlay.remove();
            opts.mainWindow?.removeEventListener("mousemove", onMove);
            opts.mainWindow?.removeEventListener("mouseup", onUp);
            saveState({ width, visible });
        };
        opts.mainWindow?.addEventListener("mousemove", onMove);
        opts.mainWindow?.addEventListener("mouseup", onUp);
    }
}

function loadState(): { width: number; visible: boolean } {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return { width: DEFAULT_WIDTH, visible: true };
        const parsed = JSON.parse(raw) as { width?: number; visible?: boolean };
        return {
            width: typeof parsed.width === "number" ? Math.max(MIN_WIDTH, parsed.width) : DEFAULT_WIDTH,
            visible: typeof parsed.visible === "boolean" ? parsed.visible : true,
        };
    } catch {
        return { width: DEFAULT_WIDTH, visible: true };
    }
}

function saveState(s: { width: number; visible: boolean }) {
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(s));
    } catch {
        // ignore
    }
}
