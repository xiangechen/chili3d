// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "@chili3d/core";

export interface MacroDefinition {
    id: string;
    name: string;
    code: string;
    createdAt: number;
    updatedAt: number;
}

const MACRO_DB = "chili3d-macros";
const MACRO_TABLE = "macros";

function generateId(): string {
    return `macro_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class MacroStorage {
    private app: IApplication;

    constructor(app: IApplication) {
        this.app = app;
    }

    async ensureStorage() {
        const storage = this.app.storage;
        await storage.createDBIfNeeded(MACRO_DB, [MACRO_TABLE]);
    }

    async getAllMacros(): Promise<MacroDefinition[]> {
        const storage = this.app.storage;
        const page = await storage.page(MACRO_DB, MACRO_TABLE, 0);
        return page as MacroDefinition[];
    }

    async getMacro(id: string): Promise<MacroDefinition | undefined> {
        const storage = this.app.storage;
        return (await storage.get(MACRO_DB, MACRO_TABLE, id)) as MacroDefinition | undefined;
    }

    async saveMacro(name: string, code: string, existingId?: string): Promise<MacroDefinition> {
        const storage = this.app.storage;
        const now = Date.now();

        let macro: MacroDefinition;
        if (existingId) {
            const existing = await this.getMacro(existingId);
            macro = {
                id: existingId,
                name,
                code,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            };
        } else {
            macro = {
                id: generateId(),
                name,
                code,
                createdAt: now,
                updatedAt: now,
            };
        }

        await storage.put(MACRO_DB, MACRO_TABLE, macro.id, macro);
        return macro;
    }

    async deleteMacro(id: string): Promise<boolean> {
        const storage = this.app.storage;
        return storage.delete(MACRO_DB, MACRO_TABLE, id);
    }
}
