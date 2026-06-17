// src/services/employeeService.ts
import { doc, setDoc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase.js';

// 従業員データの型定義（カタログ要件を反映）
export interface EmployeeData {
  uid: string;                 // AuthのユーザーID
  role: 'employee' | 'admin';  // 権限
  status: '未登録' | '入力中' | '確認待ち' | '手続完了';
  
  // 基本情報（従業員が入力）
  lastName?: string;
  firstName?: string;
  birthDate?: string;
  myNumber?: string;           // ※本来はセキュアな別管理推奨ですが今回はここに含めます
  basicPensionNumber?: string;
  
  // 契約情報（労務が入力）
  hireDate?: string;
  baseSalary?: number;
  
  updatedAt?: any;
}

/**
 * 従業員データをFirestoreに保存（または更新）する関数
 * @param uid Firebase AuthのユーザーID
 * @param data 保存する従業員データ（一部の更新にも対応）
 */
export async function saveEmployeeData(uid: string, data: Partial<EmployeeData>) {
  try {
    // 🌟 1. 念のための防壁：実行者の会社IDを取得
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId) {
        throw new Error("会社情報が読み込めないため、保存を中止しました。");
    }

    // コレクション名 "employees" の中に、UIDをキーとしてドキュメントを作成
    const employeeRef = doc(db, 'employees', uid);
    
    // 🌟 2. 修正：setDoc({merge:true}) から、より厳格な updateDoc へアップグレード！
    // （万が一UIDが間違っていても、勝手に変な幽霊データを作らずエラーにしてくれる）
    await updateDoc(employeeRef, {
      ...data,
      updatedAt: serverTimestamp() // 更新日時を自動記録
    });
    
    console.log("Firestoreへの保存（更新）に成功しました:", uid);
  } catch (error) {
    console.error("Firestoreへの保存エラー:", error);
    throw error;
  }
}