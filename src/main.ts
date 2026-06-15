import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, type User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore'; 
import { auth, db } from './config/firebase.js';  

const loginForm = document.getElementById('login-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const errorMsg = document.getElementById('error-msg') as HTMLDivElement;
const googleLoginBtn = document.getElementById('google-login-btn') as HTMLButtonElement;

// 🌟 今回追加したHTML要素
const toggleBtn = document.getElementById('toggle-mode-btn') as HTMLAnchorElement;
const formTitle = document.getElementById('form-title') as HTMLHeadingElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

// 現在「ログイン画面」なのか「アカウント作成画面」なのかを判定するフラグ
let isLoginMode = true;

// 💡 画面の切り替え（トグル）処理
if (toggleBtn && formTitle && submitBtn) {
  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault(); // リンククリックで画面が一番上に飛ぶのを防ぐ
    isLoginMode = !isLoginMode; // モードを反転

    if (isLoginMode) {
      formTitle.innerText = '社会保険管理システム';
      submitBtn.innerText = 'メールでログイン';
      toggleBtn.innerText = '初めての方はこちら（アカウント作成）';
    } else {
      formTitle.innerText = 'アカウント作成（初回登録）';
      submitBtn.innerText = 'アカウントを作成する';
      toggleBtn.innerText = '既にアカウントをお持ちの方はこちら';
    }
  });
}

// ログイン成功時・作成時の画面遷移（既存の素晴らしいロジックそのままです！）
// ログイン成功時・作成時の画面遷移
async function handleUserRouting(user: User) {
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      
      if (userData.role === 'manager' || userData.role === 'admin') {
        // ① 労務担当者ならマネージャー画面へ
        window.location.href = '/manager.html'; 
        
      } else {
        // 🌟 ここが追加ポイント！従業員の場合、手続きが終わっているか判定する
        // （例として、firstNameKanji（名前）がDBに保存されているかで判定しています）
        if (userData.firstNameKanji) {
          // ② すでに入力が終わっている人はダッシュボードへ！
          window.location.href = '/employee-dashboard.html'; 
        } else {
          // ③ まだ入力していない人はウィザードへ！
          window.location.href = '/employee.html'; 
        }
      }
    } else {
      // 新規アカウントを作った直後はデータがないので、ウィザードへ
      await setDoc(userDocRef, { role: 'employee', email: user.email, createdAt: new Date() });
      window.location.href = '/employee.html';
    }
  } catch (error) {
    console.error('データ取得エラー:', error);
  }
}

// 💡 フォーム送信（ログイン or アカウント作成）の処理
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (errorMsg) errorMsg.style.display = 'none';
      let userCredential;
      const inputEmail = emailInput.value;
      const inputPassword = passwordInput.value;

      if (isLoginMode) {
        // 【既存】ログイン処理
        userCredential = await signInWithEmailAndPassword(auth, inputEmail, inputPassword);
      } else {
        // 🌟 【新規】アカウント作成処理の前に、招待されているかチェック！
        const inviteDocRef = doc(db, 'invites', inputEmail);
        const inviteDoc = await getDoc(inviteDocRef);

        if (!inviteDoc.exists()) {
          // 招待リストに存在しない場合は、エラーを投げて処理をストップ！
          throw new Error("招待されていないメールアドレスです。管理者にご確認ください。");
        }

        // 招待リストに存在した場合のみ、アカウント作成を実行
        userCredential = await createUserWithEmailAndPassword(auth, inputEmail, inputPassword);
      }
      
      // 成功したら、共通の画面遷移関数へパス！
      await handleUserRouting(userCredential.user);
      
    } catch (error: any) {
      if (errorMsg) { 
        // 意図的に投げた日本語のエラーメッセージ、またはFirebaseのエラーを表示
        const errMsg = error.message.replace('Firebase: ', ''); // Firebase特有の文字を少し綺麗にする
        errorMsg.innerText = isLoginMode ? 'ログイン失敗：メールアドレスかパスワードが違います。' : '作成失敗：' + errMsg; 
        errorMsg.style.display = 'block'; 
      }
    }
  });
}

// Googleログイン（既存のまま完全保護）
if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', async () => {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      await handleUserRouting(userCredential.user);
    } catch (error) {
      if (errorMsg) { errorMsg.innerText = 'Googleログイン失敗'; errorMsg.style.display = 'block'; }
    }
  });
}