// ==========================================
// 🏢 法定料率・標準報酬月額マスター (insuranceMaster.ts)
// ==========================================

export interface InsuranceSettings {
  insuranceType: 'kyokai' | 'kumiai'; // 協会けんぽ か 組合健保 か
  prefecture: string;      // 都道府県（組合の場合は組合名）
  
  healthRate: number;      // 総合計の健康保険料率（※今まで通り残す！）
  healthRateEmp: number;   // 💡 NEW: 本人負担率（例: 協会なら半分の0.0499、組合なら0.040など）
  healthRateComp: number;  // 💡 NEW: 会社負担率
  
  nursingRate: number;     // 総合計の介護保険料率（※今まで通り残す！）
  nursingRateEmp: number;  // 💡 NEW: 本人負担率
  nursingRateComp: number; // 💡 NEW: 会社負担率
  
  pensionRate: number;     // 厚生年金は法律で絶対折半なので、そのまま！
  childContributionRate?: number; // ?（オプショナル）をつけておくと過去データとの互換性が保てます
  childSupportRateEmp?: number;
  childSupportRateComp?: number;
}


// 🛡️ 労務SaaS専用エンジン：社会保険料の端数処理（50銭以下切り捨て）
export function calcPremium(base: number, rate: number): number {
  const exactAmount = base * rate;
  const fraction = Math.round((exactAmount % 1) * 1000) / 1000;
  if (fraction <= 0.50) {
      return Math.floor(exactAmount);
  } else {
      return Math.ceil(exactAmount);
  }
}
  
// 💡 1. 全国の健康保険料率辞書（令和6年度 協会けんぽベース・抜粋）
// 💡 全国の健康保険料率辞書（令和6年度 協会けんぽ）
// 💡 全国の健康保険料率辞書（令和8年度 協会けんぽベース）
export const PREFECTURE_HEALTH_RATES: { [key: string]: number } = {
  '北海道': 0.1028, '青森県': 0.0985, '岩手県': 0.0951, '宮城県': 0.1010, '秋田県': 0.1001, '山形県': 0.0975, '福島県': 0.0950,
  '茨城県': 0.0952, '栃木県': 0.0982, '群馬県': 0.0968, '埼玉県': 0.0967, '千葉県': 0.0973, '東京都': 0.0985, '神奈川県': 0.0992,
  '新潟県': 0.0921, '富山県': 0.0959, '石川県': 0.0970, '福井県': 0.0971, '山梨県': 0.0955, '長野県': 0.0963, '岐阜県': 0.0980,
  '静岡県': 0.0961, '愛知県': 0.0993, '三重県': 0.0977, '滋賀県': 0.0988, '京都府': 0.0989, '大阪府': 0.1013, '兵庫県': 0.1012,
  '奈良県': 0.0991, '和歌山県': 0.1006, '鳥取県': 0.0986, '島根県': 0.0994, '岡山県': 0.1005, '広島県': 0.0978, '山口県': 0.1015,
  '徳島県': 0.1024, '香川県': 0.1002, '愛媛県': 0.0998, '高知県': 0.1005, '福岡県': 0.1011, '佐賀県': 0.1055, '長崎県': 0.1006,
  '熊本県': 0.1008, '大分県': 0.1008, '宮崎県': 0.0977, '鹿児島県': 0.1013, '沖縄県': 0.0944
};


  // 💡 初期設定（協会けんぽ・東京・令和6年度ベース）
// 💡 2. DEFAULT_RATES は「初期値（東京）」として残しつつ、辞書と連動させる！
export const DEFAULT_RATES: InsuranceSettings = {
  insuranceType: 'kyokai',
  prefecture: '東京都',
  healthRate: 0.0985,
  healthRateEmp: 0.0985 / 2,   // 協会なので半分！
  healthRateComp: 0.0985 / 2,
  nursingRate: 0.0162,
  nursingRateEmp: 0.0162 / 2,
  nursingRateComp: 0.0162 / 2,
  pensionRate: 0.1830,
  childContributionRate: 0.0036,
  childSupportRateEmp: 0.0023,
  childSupportRateComp: 0.0023
};

// 💡 3. 設定された都道府県から、計算用の「料率セット」を生成する関数
// 💡 3. getInsuranceSettings もハイブリッド版に
export function getInsuranceSettings(prefectureName: string): InsuranceSettings {
  // 辞書から探して、見つからなければ安全のために東京の料率を使う
  const hRate = PREFECTURE_HEALTH_RATES[prefectureName] || 0.0985; 
  
  return {
    insuranceType: 'kyokai',
    prefecture: prefectureName,
    healthRate: hRate,
    healthRateEmp: hRate / 2,     // 協会けんぽなのでピッタリ半分！
    healthRateComp: hRate / 2,
    nursingRate: 0.0162,
    nursingRateEmp: 0.0162 / 2,
    nursingRateComp: 0.0162 / 2,
    pensionRate: 0.1830
  };
}


  
  // 💡 標準報酬月額表（1〜50等級 完全網羅版）
  export const HEALTH_BRACKETS = [
    { grade: 1,  min: 0,       max: 62999,   base: 58000 },
    { grade: 2,  min: 63000,   max: 72999,   base: 68000 },
    { grade: 3,  min: 73000,   max: 82999,   base: 78000 },
    { grade: 4,  min: 83000,   max: 92999,   base: 88000 },  // 💡 厚生年金はここが「1等級」
    { grade: 5,  min: 93000,   max: 100999,  base: 98000 },
    { grade: 6,  min: 101000,  max: 106999,  base: 104000 },
    { grade: 7,  min: 107000,  max: 113999,  base: 110000 },
    { grade: 8,  min: 114000,  max: 121999,  base: 118000 },
    { grade: 9,  min: 122000,  max: 129999,  base: 126000 },
    { grade: 10, min: 130000,  max: 137999,  base: 134000 },
    { grade: 11, min: 138000,  max: 145999,  base: 142000 },
    { grade: 12, min: 146000,  max: 154999,  base: 150000 },
    { grade: 13, min: 155000,  max: 164999,  base: 160000 },
    { grade: 14, min: 165000,  max: 174999,  base: 170000 },
    { grade: 15, min: 175000,  max: 184999,  base: 180000 },
    { grade: 16, min: 185000,  max: 194999,  base: 190000 },
    { grade: 17, min: 195000,  max: 209999,  base: 200000 },
    { grade: 18, min: 210000,  max: 229999,  base: 220000 },
    { grade: 19, min: 230000,  max: 249999,  base: 240000 },
    { grade: 20, min: 250000,  max: 269999,  base: 260000 },
    { grade: 21, min: 270000,  max: 289999,  base: 280000 },
    { grade: 22, min: 290000,  max: 309999,  base: 300000 },
    { grade: 23, min: 310000,  max: 329999,  base: 320000 },
    { grade: 24, min: 330000,  max: 349999,  base: 340000 },
    { grade: 25, min: 350000,  max: 369999,  base: 360000 },
    { grade: 26, min: 370000,  max: 394999,  base: 380000 },
    { grade: 27, min: 395000,  max: 424999,  base: 410000 },
    { grade: 28, min: 425000,  max: 454999,  base: 440000 },
    { grade: 29, min: 455000,  max: 484999,  base: 470000 },
    { grade: 30, min: 485000,  max: 514999,  base: 500000 },
    { grade: 31, min: 515000,  max: 544999,  base: 530000 },
    { grade: 32, min: 545000,  max: 574999,  base: 560000 },
    { grade: 33, min: 575000,  max: 604999,  base: 590000 },
    { grade: 34, min: 605000,  max: 634999,  base: 620000 },
    { grade: 35, min: 635000,  max: 664999,  base: 650000 },  // 💡 厚生年金はここが「上限（32等級）」
    { grade: 36, min: 665000,  max: 694999,  base: 680000 },
    { grade: 37, min: 695000,  max: 729999,  base: 710000 },
    { grade: 38, min: 730000,  max: 769999,  base: 750000 },
    { grade: 39, min: 770000,  max: 809999,  base: 790000 },
    { grade: 40, min: 810000,  max: 854999,  base: 830000 },
    { grade: 41, min: 855000,  max: 904999,  base: 880000 },
    { grade: 42, min: 905000,  max: 954999,  base: 930000 },
    { grade: 43, min: 955000,  max: 1004999, base: 980000 },
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
// 🌟 進化した計算エンジン（子育て支援金＆1円ズレ完全対応・安全装置付き版！）
export function calculateSocialInsurance(
  totalWage: number, 
  age: number = 30, 
  rates: any = DEFAULT_RATES, 
  forceHealthGrade?: number 
) {
  
  let targetBracket;

  if (forceHealthGrade) {
    targetBracket = HEALTH_BRACKETS.find(b => b.grade === forceHealthGrade);
  } else {
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
  } else if (healthGrade > 35) {
    pensionGrade = 32;
    standardPension = 650000;
  }

  // 🛡️【NEW: 最強の安全装置】もし rates の中身が欠けていても、絶対にエラーを起こさせない！
  const safeHealthEmp = rates.healthRateEmp || (rates.healthRate ? rates.healthRate / 2 : 0);
  const safeHealthComp = rates.healthRateComp || (rates.healthRate ? rates.healthRate / 2 : 0);
  const healthTotalRate = rates.healthRate || (Math.round((safeHealthEmp + safeHealthComp) * 100000) / 100000);

  const safeNursingEmp = rates.nursingRateEmp || (rates.nursingRate ? rates.nursingRate / 2 : 0);
  const safeNursingComp = rates.nursingRateComp || (rates.nursingRate ? rates.nursingRate / 2 : 0);
  const nursingTotalRate = rates.nursingRate || (Math.round((safeNursingEmp + safeNursingComp) * 100000) / 100000);

  const pensionTotalRate = rates.pensionRate || (Math.round(((rates.pensionRateEmp || 0) + (rates.pensionRateComp || 0)) * 100000) / 100000);

  // 💡 1. 健康保険（総額から本人分を引く絶対法則）
  const healthPremium = calcPremium(standardHealth, safeHealthEmp);
  const totalHealthStatutory = Math.floor(Math.round(standardHealth * healthTotalRate * 1000) / 1000);
  const healthPremiumComp = totalHealthStatutory - healthPremium;

  // 💡 2. 厚生年金
  const pensionPremium = calcPremium(standardPension, (pensionTotalRate / 2));
  const totalPensionStatutory = Math.floor(Math.round(standardPension * pensionTotalRate * 1000) / 1000);
  const pensionPremiumComp = totalPensionStatutory - pensionPremium;

  // 💡 3. 介護保険
  const isNursingTarget = age >= 40 && age < 65;
  const nursingPremium = isNursingTarget ? calcPremium(standardHealth, safeNursingEmp) : 0;
  const totalNursingStatutory = isNursingTarget ? Math.floor(Math.round(standardHealth * nursingTotalRate * 1000) / 1000) : 0;
  const nursingPremiumComp = isNursingTarget ? (totalNursingStatutory - nursingPremium) : 0;

  // 💡 4. 子ども・子育て支援金
  const childSupportRateEmp = rates.childSupportRateEmp || 0;
  const childSupportRateComp = rates.childSupportRateComp || 0;
  const childSupportPremium = calcPremium(standardHealth, childSupportRateEmp);
  const childTotalRate = Math.round((childSupportRateEmp + childSupportRateComp) * 100000) / 100000;
  const totalChildSupportStatutory = Math.floor(Math.round(standardHealth * childTotalRate * 1000) / 1000);
  const childSupportPremiumComp = totalChildSupportStatutory - childSupportPremium;

  return {
    healthGrade,
    standardHealth,
    pensionGrade,
    standardPension,
    healthPremium,
    pensionPremium,
    nursingPremium,
    childSupportPremium, // 👈 追加！本人負担の子育て支援金
    totalDeduction: healthPremium + pensionPremium + nursingPremium + childSupportPremium,

    healthPremiumComp,   
    pensionPremiumComp,
    nursingPremiumComp,
    childSupportPremiumComp, // 👈 追加！会社負担の子育て支援金
    totalCompBurden: healthPremiumComp + pensionPremiumComp + nursingPremiumComp + childSupportPremiumComp
  };
}

  