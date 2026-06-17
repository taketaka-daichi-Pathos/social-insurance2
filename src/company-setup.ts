import { db } from './config/firebase.js';
import { doc, updateDoc } from 'firebase/firestore';

document.addEventListener('DOMContentLoaded', () => {
  const btnSetupComplete = document.getElementById('btn-setup-complete') as HTMLButtonElement;
  const companyNameInput = document.getElementById('company-name') as HTMLInputElement;

  if (!btnSetupComplete || !companyNameInput) return;

  btnSetupComplete.addEventListener('click', async () => {
    const companyName = companyNameInput.value.trim();

    // 🌟 1. 空白チェック（何も入力せずに進ませない！）
    if (!companyName) {
      alert("会社名を入力してください。");
      companyNameInput.focus();
      return;
    }

    // 🌟 2. アカウント作成時に発行した「自分の会社ID」をローカルストレージから取得
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId) {
      alert("エラー：会社情報が見つかりません。もう一度ログインし直してください。");
      window.location.href = '/login.html'; // 異常時はログイン画面に追い返す
      return;
    }

    try {
      // 🌟 3. ボタンをローディング状態にして連打を防ぐ
      btnSetupComplete.innerText = "⏳ 準備中...";
      btnSetupComplete.disabled = true;

      // 🌟 4. 【本命】Firestoreの「companies」コレクションの会社名を上書きする！
      const companyRef = doc(db, 'companies', currentCompanyId);
      await updateDoc(companyRef, {
        companyName: companyName,
        updatedAt: new Date()
      });

      // 🌟 5. 設定完了！ついにダッシュボード（manager.html）へ送り出す！
      window.location.href = '/manager.html';

    } catch (error) {
      console.error("会社名登録エラー:", error);
      alert("会社名の登録に失敗しました。通信環境を確認してもう一度お試しください。");
      btnSetupComplete.innerText = "L-FLAGをはじめる";
      btnSetupComplete.disabled = false;
    }
  });
});