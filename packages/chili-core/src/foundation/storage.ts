// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface IStorage {
    readonly version: number;
    get(database: string, table: string, id: string): Promise<any>;
    put(database: string, table: string, id: string, value: any): Promise<boolean>;
    delete(database: string, table: string, id: string): Promise<boolean>;
    page(database: string, table: string, page: number): Promise<any[]>;
}
