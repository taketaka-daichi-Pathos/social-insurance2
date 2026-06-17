declare global {
    interface Window {
        showReviewPanel: (email: string) => Promise<void>;
    }
}
export declare function initSalaryFilterUI(activeId: string, retiredId: string, selectId: string, storageKey: string, reRenderCallback: () => void): void;
export declare function checkAndProcessRetirementTask(task: any): Promise<void>;
//# sourceMappingURL=manager.d.ts.map