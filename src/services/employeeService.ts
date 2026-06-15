// src/services/employeeService.ts
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
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
    // コレクション名 "employees" の中に、UIDをキーとしてドキュメントを作成
    const employeeRef = doc(db, 'employees', uid);
    
    // { merge: true } をつけることで、既存データを消さずに差分だけ更新します
    await setDoc(employeeRef, {
      ...data,
      updatedAt: serverTimestamp() // 更新日時を自動記録
    }, { merge: true });
    
    console.log("Firestoreへの保存に成功しました:", uid);
  } catch (error) {
    console.error("Firestoreへの保存エラー:", error);
    throw error;
  }
}