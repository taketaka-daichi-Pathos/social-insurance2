import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, type User } from 'firebase/auth';
// 🌟 collection を追加インポート（新しい会社IDを自動生成するため）
import { doc, getDoc, setDoc, collection,deleteDoc } from 'firebase/firestore'; 
import { auth, db } from './config/firebase.js';  

const loginForm = document.getElementById('login-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const errorMsg = document.getElementById('error-msg') as HTMLDivElement;
const googleLoginBtn = document.getElementById('google-login-btn') as HTMLButtonElement;

const toggleBtn = document.getElementById('toggle-mode-btn') as HTMLAnchorElement;
const formTitle = document.getElementById('form-title') as HTMLHeadingElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

let isLoginMode = true;

// 💡 画面の切り替え（トグル）処理
if (toggleBtn && formTitle && submitBtn) {
  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;

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

// 👑 ログイン成功時・作成時の画面遷移（SaaS対応版マルチルーティング）
async function handleUserRouting(user: User) {
  // 👇＝＝＝ 🌟 STEP 1: ここを追加！ ＝＝＝👇
  // ログイン成功直後（データを読み込み始める前）に、必ず過去の会社の記憶を破壊する！
  localStorage.removeItem('hr_employee_master');
  localStorage.removeItem('hr_employee_sequence');
  // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      // ============================================================
      // 既存ユーザーのログイン時
      // ============================================================
      const userData = userDoc.data();
      
      // 🔑 ログインした人の会社IDをブラウザにそっと記憶させておく（超重要伏線！）
      if (userData.companyId) {
        localStorage.setItem('current_company_id', userData.companyId);
      }
      
      if (userData.role === 'manager' || userData.role === 'admin') {
        window.location.href = '/manager.html'; 
      } else {
        if (userData.firstNameKanji) {
          window.location.href = '/employee-dashboard.html'; 
        } else {
          window.location.href = '/employee.html'; 
        }
      }
    } else {
      // ============================================================
      // 🌟🌟🌟 新規アカウントを作った直後（運命の分かれ道） 🌟🌟🌟

    
    // 変更点：invitesではなく、usersコレクションの中に「自分のメアド」の箱がないか探す！
    const preRegisteredDocRef = doc(db, 'users', user.email!);
    const preRegisteredDoc = await getDoc(preRegisteredDocRef);

    if (preRegisteredDoc.exists()) {
        // 🟢 パターンA: 労務担当に事前追加されていて、今回初めてアカウントを作った従業員
        const preData = preRegisteredDoc.data();
        
        // 1. 新しいUIDの箱に、事前データをまるごと引っ越し（引き継ぎ）する！
        await setDoc(userDocRef, {
            ...preData, // 手動追加された時の名前や会社IDをすべて展開して合流
            role: 'employee',
            uid: user.uid,
            createdAt: new Date()
        });

        // 2. 引っ越しが終わったら、古い「メアドの箱」は用済みなので削除する（お掃除）
        // ※エラーが出る場合は、ファイルの先頭の import { ... } の中に deleteDoc を追加してください！
        await deleteDoc(preRegisteredDocRef);

        // 3. 会社IDを記憶して、入社ウィザード（またはダッシュボード）へ案内！
        localStorage.setItem('current_company_id', preData.companyId);
        window.location.href = '/employee-dashboard.html';

    } else {
        // 🔴 パターンB: 事前データなし＝完全に初めてシステムを使う「会社開設者（労務担当）」！
        // （※ここから下の const newCompanyRef = ... の処理はそのまま残してください！）
        
        // 📦 Firestoreの仕組みを使って、世界に1つだけの新しい「ユニークな会社ID」を自動発行！
        const newCompanyRef = doc(collection(db, 'companies'));
        const newCompanyId = newCompanyRef.id;


// 🌟 【ここを追加！】発行したIDを使って、実際に「会社の箱」をデータベース上に建造しておく！
        await setDoc(newCompanyRef, {
            createdAt: new Date(),
            ownerEmail: user.email,
            companyName: "未設定の会社" // ※あとで設定画面で変更してもらえばOK！
        });

        await setDoc(userDocRef, { 
          role: 'manager', // 1人目なのでマスター管理者権限を付与
          email: user.email, 
          companyId: newCompanyId, // 新しく発行した自分専用の会社IDを刻む！
          createdAt: new Date() 
        });
        
        // 新しい会社IDを記憶して、管理画面の「会社設定」へ突入させる！
        localStorage.setItem('current_company_id', newCompanyId);
        window.location.href = '/company-setup.html';
      }
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
        userCredential = await signInWithEmailAndPassword(auth, inputEmail, inputPassword);
      } else {
        // 🌟 変更点：エラーではじくのをやめて、誰でもウェルカムでアカウント作成を許可！
        // （招待の有無による分岐は、作成後の handleUserRouting 側が自動で処理してくれます）
        userCredential = await createUserWithEmailAndPassword(auth, inputEmail, inputPassword);
      }
      
      await handleUserRouting(userCredential.user);
      
    } catch (error: any) {
      if (errorMsg) { 
        const errMsg = error.message.replace('Firebase: ', '');
        errorMsg.innerText = isLoginMode ? 'ログイン失敗：メールアドレスかパスワードが違います。' : '作成失敗：' + errMsg; 
        errorMsg.style.display = 'block'; 
      }
    }
  });
}

// Googleログイン
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