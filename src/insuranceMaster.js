// ==========================================
// 🏢 法定料率・標準報酬月額マスター (insuranceMaster.ts)
// ==========================================
// 💡 1. 全国の健康保険料率辞書（令和6年度 協会けんぽベース・抜粋）
// 💡 全国の健康保険料率辞書（令和6年度 協会けんぽ）
export const PREFECTURE_HEALTH_RATES = {
    '北海道': 0.1021, '青森県': 0.0977, '岩手県': 0.0980, '宮城県': 0.0983, '秋田県': 0.0983,
    '山形県': 0.0987, '福島県': 0.0977, '茨城県': 0.0987, '栃木県': 0.0984, '群馬県': 0.0981,
    '埼玉県': 0.0978, '千葉県': 0.0980, '東京都': 0.0998, '神奈川県': 0.0999, '新潟県': 0.0982,
    '富山県': 0.0969, '石川県': 0.0989, '福井県': 0.0989, '山梨県': 0.0974, '長野県': 0.0971,
    '岐阜県': 0.0984, '静岡県': 0.0979, '愛知県': 0.0999, '三重県': 0.0976, '滋賀県': 0.0977,
    '京都府': 0.1002, '大阪府': 0.1034, '兵庫県': 0.1020, '奈良県': 0.0994, '和歌山県': 0.0987,
    '鳥取県': 0.0988, '島根県': 0.0990, '岡山県': 0.1003, '広島県': 0.0993, '山口県': 0.1005,
    '徳島県': 0.1015, '香川県': 0.1020, '愛媛県': 0.0997, '高知県': 0.1009, '福岡県': 0.1035,
    '佐賀県': 0.1042, '長崎県': 0.1032, '熊本県': 0.1036, '大分県': 0.1012, '宮崎県': 0.0986,
    '鹿児島県': 0.1009, '沖縄県': 0.0996
};
// 💡 初期設定（協会けんぽ・東京・令和6年度ベース）
// 💡 2. DEFAULT_RATES は「初期値（東京）」として残しつつ、辞書と連動させる！
export const DEFAULT_RATES = {
    insuranceType: 'kyokai',
    prefecture: '東京都',
    healthRate: 0.0998,
    healthRateEmp: 0.0998 / 2, // 協会なので半分！
    healthRateComp: 0.0998 / 2,
    nursingRate: 0.0160,
    nursingRateEmp: 0.0160 / 2,
    nursingRateComp: 0.0160 / 2,
    pensionRate: 0.1830,
    childContributionRate: 0.0036,
    childSupportRateEmp: 0,
    childSupportRateComp: 0
};
// 💡 3. 設定された都道府県から、計算用の「料率セット」を生成する関数
// 💡 3. getInsuranceSettings もハイブリッド版に
export function getInsuranceSettings(prefectureName) {
    // 辞書から探して、見つからなければ安全のために東京の料率を使う
    const hRate = PREFECTURE_HEALTH_RATES[prefectureName] || 0.0998;
    return {
        insuranceType: 'kyokai',
        prefecture: prefectureName,
        healthRate: hRate,
        healthRateEmp: hRate / 2, // 協会けんぽなのでピッタリ半分！
        healthRateComp: hRate / 2,
        nursingRate: 0.0160,
        nursingRateEmp: 0.0160 / 2,
        nursingRateComp: 0.0160 / 2,
        pensionRate: 0.1830
    };
}
// 💡 標準報酬月額表（1〜50等級 完全網羅版）
export const HEALTH_BRACKETS = [
    { grade: 1, min: 0, max: 62999, base: 58000 },
    { grade: 2, min: 63000, max: 72999, base: 68000 },
    { grade: 3, min: 73000, max: 82999, base: 78000 },
    { grade: 4, min: 83000, max: 92999, base: 88000 }, // 💡 厚生年金はここが「1等級」
    { grade: 5, min: 93000, max: 100999, base: 98000 },
    { grade: 6, min: 101000, max: 106999, base: 104000 },
    { grade: 7, min: 107000, max: 113999, base: 110000 },
    { grade: 8, min: 114000, max: 121999, base: 118000 },
    { grade: 9, min: 122000, max: 129999, base: 126000 },
    { grade: 10, min: 130000, max: 137999, base: 134000 },
    { grade: 11, min: 138000, max: 145999, base: 142000 },
    { grade: 12, min: 146000, max: 154999, base: 150000 },
    { grade: 13, min: 155000, max: 164999, base: 160000 },
    { grade: 14, min: 165000, max: 174999, base: 170000 },
    { grade: 15, min: 175000, max: 184999, base: 180000 },
    { grade: 16, min: 185000, max: 194999, base: 190000 },
    { grade: 17, min: 195000, max: 209999, base: 200000 },
    { grade: 18, min: 210000, max: 229999, base: 220000 },
    { grade: 19, min: 230000, max: 249999, base: 240000 },
    { grade: 20, min: 250000, max: 269999, base: 260000 },
    { grade: 21, min: 270000, max: 289999, base: 280000 },
    { grade: 22, min: 290000, max: 309999, base: 300000 },
    { grade: 23, min: 310000, max: 329999, base: 320000 },
    { grade: 24, min: 330000, max: 349999, base: 340000 },
    { grade: 25, min: 350000, max: 369999, base: 360000 },
    { grade: 26, min: 370000, max: 394999, base: 380000 },
    { grade: 27, min: 395000, max: 424999, base: 410000 },
    { grade: 28, min: 425000, max: 454999, base: 440000 },
    { grade: 29, min: 455000, max: 484999, base: 470000 },
    { grade: 30, min: 485000, max: 514999, base: 500000 },
    { grade: 31, min: 515000, max: 544999, base: 530000 },
    { grade: 32, min: 545000, max: 574999, base: 560000 },
    { grade: 33, min: 575000, max: 604999, base: 590000 },
    { grade: 34, min: 605000, max: 634999, base: 620000 },
    { grade: 35, min: 635000, max: 664999, base: 650000 }, // 💡 厚生年金はここが「上限（32等級）」
    { grade: 36, min: 665000, max: 694999, base: 680000 },
    { grade: 37, min: 695000, max: 729999, base: 710000 },
    { grade: 38, min: 730000, max: 769999, base: 750000 },
    { grade: 39, min: 770000, max: 809999, base: 790000 },
    { grade: 40, min: 810000, max: 854999, base: 830000 },
    { grade: 41, min: 855000, max: 904999, base: 880000 },
    { grade: 42, min: 905000, max: 954999, base: 930000 },
    { grade: 43, min: 955000, max: 1004999, base: 980000 },
    { grade: 44, min: 1005000, max: 1054999, base: 1030000 },
    { grade: 45, min: 1055000, max: 1114999, base: 1090000 },
    { grade: 46, min: 1115000, max: 1174999, base: 1150000 },
    { grade: 47, min: 1175000, max: 1234999, base: 1210000 },
    { grade: 48, min: 1235000, max: 1294999, base: 1270000 },
    { grade: 49, min: 1295000, max: 1354999, base: 1330000 },
    { grade: 50, min: 1355000, max: Infinity, base: 1390000 } // 上限なし
];
/**
 * 💰 固定的賃金から「等級」と「保険料」を全自動で算出するメインエンジン
 * @param totalWage 固定的賃金の合計（交通費込み）
 * @param age 年齢（介護保険の判定用。初期値30歳）
 * @param rates 適用する料率マスタ
 */
// 🌟 進化した計算エンジン（第4の引数「forceHealthGrade」を追加！）
// 🌟 進化した計算エンジン（子育て支援金 完全対応版！）
export function calculateSocialInsurance(totalWage, age = 30, rates = DEFAULT_RATES, forceHealthGrade) {
    let targetBracket;
    if (forceHealthGrade) {
        targetBracket = HEALTH_BRACKETS.find(b => b.grade === forceHealthGrade);
    }
    else {
        targetBracket = HEALTH_BRACKETS.find(b => totalWage >= b.min && totalWage <= b.max);
    }
    const safeBracket = targetBracket || { grade: 1, base: 58000 };
    const standardHealth = safeBracket.base;
    const healthGrade = safeBracket.grade;
    let pensionGrade = 1;
    let standardPension = 88000;
    if (healthGrade >= 4 && healthGrade <= 35) {
        pensionGrade = healthGrade - 3;
        standardPension = standardHealth;
    }
    else if (healthGrade > 35) {
        pensionGrade = 32;
        standardPension = 650000;
    }
    // 健康保険
    const healthPremium = Math.round(standardHealth * rates.healthRateEmp);
    const healthPremiumComp = Math.round(standardHealth * rates.healthRateComp);
    // 厚生年金
    const pensionPremium = Math.round(standardPension * (rates.pensionRate / 2));
    const pensionPremiumComp = pensionPremium;
    // 介護保険
    const isNursingTarget = age >= 40 && age < 65;
    const nursingPremium = isNursingTarget ? Math.round(standardHealth * rates.nursingRateEmp) : 0;
    const nursingPremiumComp = isNursingTarget ? Math.round(standardHealth * rates.nursingRateComp) : 0;
    // 🌟 NEW: 子ども・子育て支援金の計算（マスタ設定 rates を使用！）
    // ※ 万が一 rates に入っていない時のために、フォールバック（|| 0）を入れています
    const childSupportRateEmp = rates.childSupportRateEmp || 0;
    const childSupportRateComp = rates.childSupportRateComp || 0;
    const childSupportPremium = Math.round(standardHealth * childSupportRateEmp);
    const childSupportPremiumComp = Math.round(standardHealth * childSupportRateComp);
    return {
        healthGrade,
        standardHealth,
        pensionGrade,
        standardPension,
        healthPremium,
        pensionPremium,
        nursingPremium,
        childSupportPremium, // 👈 追加！本人負担の子育て支援金
        totalDeduction: healthPremium + pensionPremium + nursingPremium + childSupportPremium, // 👈 合計にも足す！
        healthPremiumComp,
        pensionPremiumComp,
        nursingPremiumComp,
        childSupportPremiumComp, // 👈 追加！会社負担の子育て支援金
        totalCompBurden: healthPremiumComp + pensionPremiumComp + nursingPremiumComp + childSupportPremiumComp // 👈 合計にも足す！
    };
}
//# sourceMappingURL=insuranceMaster.js.map