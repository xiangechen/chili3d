import { HistoryOperation, IHistory } from "../src";

export class TestHistory implements IHistory {
    private _undoCount: number = 0;
    private _redoCount: number = 0;

    get isDisabled(): boolean {
        return false;
    }
    add(action: HistoryOperation): void {
        this._undoCount++;
    }
    undo(): void {
        this._undoCount++;
    }
    redo(): void {
        this._redoCount++;
    }
    undoCount(): number {
        return this._undoCount;
    }
    redoCount(): number {
        return this._redoCount;
    }
}
