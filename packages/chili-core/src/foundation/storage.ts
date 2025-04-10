// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

export interface IStorage {
    readonly version: number;
    get(database: string, table: string, id: string): Promise<any>;
    put(database: string, table: string, id: string, value: any): Promise<boolean>;
    delete(database: string, table: string, id: string): Promise<boolean>;
    page(database: string, table: string, page: number): Promise<any[]>;
}
