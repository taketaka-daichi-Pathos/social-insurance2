export interface EmployeeData {
    uid: string;
    role: 'employee' | 'admin';
    status: '未登録' | '入力中' | '確認待ち' | '手続完了';
    lastName?: string;
    firstName?: string;
    birthDate?: string;
    myNumber?: string;
    basicPensionNumber?: string;
    hireDate?: string;
    baseSalary?: number;
    updatedAt?: any;
}
/**
 * 従業員データをFirestoreに保存（または更新）する関数
 * @param uid Firebase AuthのユーザーID
 * @param data 保存する従業員データ（一部の更新にも対応）
 */
export declare function saveEmployeeData(uid: string, data: Partial<EmployeeData>): Promise<void>;
//# sourceMappingURL=employeeService.d.ts.map