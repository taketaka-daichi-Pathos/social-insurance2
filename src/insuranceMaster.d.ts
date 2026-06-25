export interface InsuranceSettings {
    insuranceType: 'kyokai' | 'kumiai';
    prefecture: string;
    healthRate: number;
    healthRateEmp: number;
    healthRateComp: number;
    nursingRate: number;
    nursingRateEmp: number;
    nursingRateComp: number;
    pensionRate: number;
    childContributionRate?: number;
    childSupportRateEmp?: number;
    childSupportRateComp?: number;
}
export declare function calcPremium(base: number, rate: number): number;
export declare const PREFECTURE_HEALTH_RATES: {
    [key: string]: number;
};
export declare const DEFAULT_RATES: InsuranceSettings;
export declare function getInsuranceSettings(prefectureName: string): InsuranceSettings;
export declare const HEALTH_BRACKETS: {
    grade: number;
    min: number;
    max: number;
    base: number;
}[];
/**
 * 💰 固定的賃金から「等級」と「保険料」を全自動で算出するメインエンジン
 * @param totalWage 固定的賃金の合計（交通費込み）
 * @param age 年齢（介護保険の判定用。初期値30歳）
 * @param rates 適用する料率マスタ
 */
export declare function calculateSocialInsurance(totalWage: number, age?: number, rates?: any, forceHealthGrade?: number, isExempt?: boolean, // 💡 元の位置（5番目）に戻す！
forcePensionGrade?: number): {
    healthGrade: number;
    standardHealth: number;
    pensionGrade: number;
    standardPension: number;
    healthPremium: number;
    pensionPremium: number;
    nursingPremium: number;
    childSupportPremium: number;
    totalDeduction: number;
    healthPremiumComp: number;
    pensionPremiumComp: number;
    nursingPremiumComp: number;
    childSupportPremiumComp: number;
    totalCompBurden: number;
};
//# sourceMappingURL=insuranceMaster.d.ts.map