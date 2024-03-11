// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export interface IStorage {
    readonly version: number;
    get(database: string, table: string, id: string): Promise<any>;
    put(database: string, table: string, id: string, value: any): Promise<boolean>;
    delete(database: string, table: string, id: string): Promise<boolean>;
    page(database: string, table: string, page: number): Promise<any[]>;
}
