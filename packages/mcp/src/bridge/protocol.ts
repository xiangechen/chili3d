// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Wire protocol for the live bridge that lets an MCP controller drive the model
// the user is looking at in the browser. Type-only import of Op keeps zod (and the
// whole CAD-program schema) out of the browser bundle.
import type { Op } from "../program/schema";

export type { Op };

export const DEFAULT_BRIDGE_PORT = 8765;
export const DEFAULT_BRIDGE_URL = `ws://localhost:${DEFAULT_BRIDGE_PORT}`;

export type Role = "browser" | "controller";

export type BridgeAction =
    | "get_state"
    | "new_document"
    | "run_cad_program"
    | "export_stl"
    | "export_step"
    | "save_document"
    | "render_preview"
    | "get_properties";

export interface HelloMessage {
    kind: "hello";
    role: Role;
}

export interface RequestMessage {
    kind: "request";
    id: string;
    action: BridgeAction;
    name?: string; // new_document
    ops?: Op[]; // run_cad_program
    binary?: boolean; // export_stl: binary (default) vs ascii
}

export interface DocumentState {
    hasActiveDocument: boolean;
    documentId?: string;
    documentName?: string;
    nodeCount?: number;
    addedNodeIds?: string[];
}

export type DataType = "stl" | "step" | "cd" | "png" | "properties";

export interface ResponseMessage {
    kind: "response";
    id: string;
    ok: boolean;
    error?: string;
    state?: DocumentState;
    /** Payload for export/preview/measure: base64 (stl/png) or plain text (step/cd/properties JSON). */
    data?: string;
    dataType?: DataType;
}

export type BridgeMessage = HelloMessage | RequestMessage | ResponseMessage;
