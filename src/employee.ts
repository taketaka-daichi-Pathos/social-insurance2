import { signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, updateDoc, setDoc,collection, addDoc, getDoc } from 'firebase/firestore'; 
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'; 
import { auth, db, storage } from './config/firebase.js';

// ==========================================
// 🚪 ログアウト処理（エラーで止まらないよう最上部に配置）
// ==========================================
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
logoutBtn?.addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = '/'; 
  } catch (err) {
    console.error("ログアウトエラー:", err);
  }
});

let currentUserEmail: string | null = null;
let currentUserId: string | null = null;

onAuthStateChanged(auth, async(user) => {
  if (user) {
    currentUserEmail = user.email;
    currentUserId = user.uid;
    console.log("従業員ログイン中:", currentUserEmail);

// 👇＝＝＝ ここから「データの復元処理」を追加 ＝＝＝👇
try {
  // 1. Firestoreから自分の入社データを取得
  const userSnap = await getDoc(doc(db, 'users', currentUserId));
  
  if (userSnap.exists()) {
    const data = userSnap.data();
    
    // 💡 テキスト入力欄に値をセットする便利関数
    const setValue = (id: string, val: any) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el && val !== undefined) el.value = val;
    };

    // 2. 過去のデータを各入力欄に流し込む
    setValue('last-name-kanji', data.lastNameKanji);
    setValue('first-name-kanji', data.firstNameKanji);
    setValue('last-name-kana', data.lastNameKana);
    setValue('first-name-kana', data.firstNameKana);
    setValue('birthdate', data.birthdate);
    setValue('gender', data.gender);
    setValue('current-address', data.currentAddress);
    setValue('registered-address', data.registeredAddress);
    
    setValue('mynumber', data.myNumber);
    setValue('pension-num', data.pensionNumber);
    setValue('emp-insurance-num', data.empInsuranceNum); // 雇用保険番号
    // 👇＝＝＝ これを追加！ ＝＝＝👇
        // 過去にアップロード済みの画像があれば、inputタグに「saved="true"」という目印をつける！
        if (data.myNumberImageUrl) {
          document.getElementById('mynumber-image')?.setAttribute('data-saved', 'true');
      }
      if (data.pensionImageUrl) {
          document.getElementById('pension-image')?.setAttribute('data-saved', 'true');
      }// ✨ NEW: 雇用保険の画像にも目印をつける！
      if (data.empInsuranceImageUrl) {
        document.getElementById('emp-insurance-image')?.setAttribute('data-saved', 'true');
    }
      // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
    setValue('commute-route', data.commuteRoute);
    
    if (data.allowances) {
        setValue('commute-allowance', data.allowances.commute);
    }

    // 銀行情報の復元
    if (data.bankInfo) {
      setValue('bank-name', data.bankInfo.bankName);
      setValue('branch-name', data.bankInfo.branchName);
      setValue('account-type', data.bankInfo.accountType);
      setValue('account-num', data.bankInfo.accountNumber);
    }

    // 💡 ラジオボタン・チェックボックスの復元
    if (data.isForeigner) {
        const radioForeign = document.getElementById('radio-foreign') as HTMLInputElement;
        if (radioForeign) radioForeign.checked = true;
    }
    if (data.hasPreviousIncome) {
        const radioIncomeYes = document.getElementById('radio-income-yes') as HTMLInputElement;
        if (radioIncomeYes) radioIncomeYes.checked = true;
    }
    if (data.hasDependent) {
        const radioDepYes = document.querySelector('input[name="has-dependent"][value="yes"]') as HTMLInputElement;
        if (radioDepYes) radioDepYes.checked = true;
    }

    console.log("✅ 過去の入力データを画面に復元しました！");
  }
} catch (error) {
  console.error("データ復元エラー:", error);
}
// ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝

  } else {
    // テスト中に勝手に画面が戻るのを防ぐため、一旦ログ出しのみにします
    console.log("未ログイン状態です");
  }
});

// ==========================================
// 🛠️ UI開閉・分岐ロジック（両ボタン監視・徹底安全版）
// ==========================================

// 1. 国籍分岐（日本・外国籍の両方の変化を監視）
function toggleForeignSection() {
  const radioForeign = document.getElementById('radio-foreign') as HTMLInputElement;
  const foreignSection = document.getElementById('foreign-section') as HTMLDivElement;
  if (radioForeign && foreignSection) {
    if (radioForeign.checked) {
      foreignSection.classList.remove('hidden');
    } else {
      foreignSection.classList.add('hidden');
    }
  }
}
document.getElementById('radio-foreign')?.addEventListener('change', toggleForeignSection);
document.getElementById('radio-japan')?.addEventListener('change', toggleForeignSection);

// 2. 住所分岐
const addressSameCheck = document.getElementById('address-same-check') as HTMLInputElement;
const registeredAddressSection = document.getElementById('registered-address-section') as HTMLDivElement;
addressSameCheck?.addEventListener('change', (e) => {
  if (registeredAddressSection) {
    registeredAddressSection.classList.toggle('hidden', (e.target as HTMLInputElement).checked);
  }
});

// 3. 前職・所得分岐（はい・いいえの両方を監視）
function toggleTaxSection() {
  const radioIncomeYes = document.getElementById('radio-income-yes') as HTMLInputElement;
  const taxSlipSection = document.getElementById('tax-slip-section') as HTMLDivElement;
  if (radioIncomeYes && taxSlipSection) {
    if (radioIncomeYes.checked) {
      taxSlipSection.classList.remove('hidden');
    } else {
      taxSlipSection.classList.add('hidden');
    }
  }
}
document.getElementById('radio-income-yes')?.addEventListener('change', toggleTaxSection);
document.getElementById('radio-income-no')?.addEventListener('change', toggleTaxSection);

// 4. 扶養家族分岐
function toggleDependentSection() {
  const radioDepYes = document.querySelector('input[name="has-dependent"][value="yes"]') as HTMLInputElement;
  const dependentSection = document.getElementById('dependent-section') as HTMLDivElement;
  if (radioDepYes && dependentSection) {
    if (radioDepYes.checked) {
      dependentSection.classList.remove('hidden');
      calculateRequiredDocs(); // 書類計算を走らせる
    } else {
      dependentSection.classList.add('hidden');
    }
  }
}
document.querySelectorAll('input[name="has-dependent"]').forEach(radio => {
  radio.addEventListener('change', toggleDependentSection);
});

// 5. 扶養家族の必要書類・自動計算
const depInputs = document.querySelectorAll('.dep-input');
depInputs.forEach(input => {
  input.addEventListener('change', calculateRequiredDocs);
});

function calculateRequiredDocs() {
  const statusSelect = document.getElementById('dep-status') as HTMLSelectElement;
  const livingSelect = document.getElementById('dep-living') as HTMLSelectElement;
  const docNavArea = document.getElementById('doc-nav-area') as HTMLDivElement;
  const docUploadContainer = document.getElementById('doc-upload-container') as HTMLDivElement;

  if (!statusSelect || !livingSelect || !docNavArea || !docUploadContainer) return;

  const status = statusSelect.value;
  const living = livingSelect.value;
  const requiredDocs = new Set<string>();

  if (status === '直近で退職/失業保険終了') requiredDocs.add('退職証明書 または 離職票（１・２）のコピー');
  if (status === '16歳以上の学生') requiredDocs.add('学生証のコピー または 在学証明書');
  if (status === '継続して無職/パート') requiredDocs.add('最新の非課税証明書（または課税証明書）');
  if (status === '年金受給者') requiredDocs.add('年金振込通知書 および 年金額改定通知書');
  if (living === '別居') requiredDocs.add('仕送りしている通帳のコピー（直近の送金実績が分かるもの）');

  if (requiredDocs.size > 0) {
    docNavArea.classList.remove('hidden');
    docUploadContainer.innerHTML = '';
    requiredDocs.forEach((docName) => {
      const itemDiv = document.createElement('div');
      itemDiv.style.background = '#fff';
      itemDiv.style.padding = '12px';
      itemDiv.style.borderRadius = '4px';
      itemDiv.style.border = '1px solid #b3d7ff';
      itemDiv.style.marginTop = '8px';
      itemDiv.innerHTML = `
        <div style="font-size: 13px; font-weight: bold; color: #0056b3; margin-bottom: 6px;">📄 ${docName}</div>
        <input type="file" class="dep-file-input" data-doc-name="${docName}" style="width: 100%;">
      `;
      docUploadContainer.appendChild(itemDiv);
    });
  } else {
    docNavArea.classList.add('hidden');
  }
}

// 💡 共通のファイルアップロード関数
async function uploadFileToStorage(file: File, folderPath: string): Promise<string> {
    const storageRef = ref(storage, `${folderPath}/${Date.now()}_${file.name}`);
    
    // 💡 修正：種類が空っぽの場合は、強制的に 'image/jpeg' を名札にする
    const metadata = {
      contentType: file.type || 'image/jpeg',
    };
  
    const snapshot = await uploadBytes(storageRef, file, metadata);
    return await getDownloadURL(snapshot.ref);
  }

// === 6. フォーム送信処理 ===
const infoForm = document.getElementById('info-form') as HTMLFormElement;
const msgDiv = document.getElementById('msg') as HTMLDivElement;

infoForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUserEmail || !currentUserId) return alert("認証エラーです。再ログインしてください。");

// ==========================================
  // 🛡️ 1. テキスト項目の必須バリデーション
  // ==========================================
  const requiredFields = [
    { id: 'last-name-kanji', name: '氏名（姓）' },
    { id: 'first-name-kanji', name: '氏名（名）' },
    { id: 'last-name-kana', name: 'フリガナ（セイ）' }, // ✨ カナもしっかりチェック！
    { id: 'first-name-kana', name: 'フリガナ（メイ）' }, // ✨ カナもしっかりチェック！
    { id: 'birthdate', name: '生年月日' },
    { id: 'gender', name: '性別' },
    { id: 'current-address', name: '現住所' },
    { id: 'mynumber', name: 'マイナンバー（12桁）' },
    { id: 'pension-num', name: '基礎年金番号' },
    { id: 'emp-insurance-num', name: '雇用保険被保険者番号' }, // ✨ これも必須化！
    { id: 'bank-name', name: '振込先銀行名' },
    { id: 'branch-name', name: '支店名' },
    { id: 'account-num', name: '口座番号' },
    // 👇＝＝＝ これを一番下などに追加！ ＝＝＝👇
    { id: 'commute-route', name: '通勤経路' },
    { id: 'commute-allowance', name: '1ヶ月の定期代' }
    // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
  ];

  let firstErrorElement: HTMLElement | null = null;

  for (const field of requiredFields) {
    const inputEl = document.getElementById(field.id) as HTMLInputElement;
    if (!inputEl || !inputEl.value.trim()) {
      // 🚨 未入力なら赤枠にする
      if (inputEl) {
        inputEl.style.border = '2px solid #dc3545';
        inputEl.style.backgroundColor = '#fff5f5';
      }
      if (!firstErrorElement) firstErrorElement = inputEl;
    } else {
      // ✅ 入力されていれば元に戻す
      if (inputEl) {
        inputEl.style.border = '';
        inputEl.style.backgroundColor = '';
      }
    }
  }

  // 💥 テキスト項目に未入力があれば、ここでスクロールして送信ストップ！
  if (firstErrorElement) {
    if (msgDiv) {
      msgDiv.style.display = 'block';
      msgDiv.style.backgroundColor = '#f8d7da';
      msgDiv.style.color = '#721c24';
      msgDiv.innerText = '⚠️ 入力内容に不備があります。赤枠の必須項目をすべて入力してください。';
    }
    firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstErrorElement.focus();
    return; // 🛑 ストップ！
  }

  // ==========================================
  // 📸 2. 画像ファイルの必須バリデーション
  // ==========================================
  const validateImage = (inputId: string, errorMsg: string) => {
      const inputEl = document.getElementById(inputId) as HTMLInputElement;
      if (inputEl && (!inputEl.files || inputEl.files.length === 0) && inputEl.getAttribute('data-saved') !== 'true') {
          alert(errorMsg);
          inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          inputEl.style.outline = '3px solid #dc3545';
          inputEl.style.outlineOffset = '2px';
          return false;
      }
      if (inputEl) {
          inputEl.style.outline = '';
          inputEl.style.outlineOffset = '';
      }
      return true;
  };

  // 💥 画像が足りなければここで送信ストップ！
  if (!validateImage('mynumber-image', '⚠️ マイナンバーの画像が添付されていません！')) return;
  if (!validateImage('pension-image', '⚠️ 年金手帳（または基礎年金番号通知書）の画像が添付されていません！')) return;
  if (!validateImage('emp-insurance-image', '⚠️ 雇用保険被保険者証の画像が添付されていません！')) return;


  // ==========================================
  // ✅ 全てのチェックを通過！Firestoreへの保存処理へ
  // ==========================================
  try {
    if (msgDiv) {
      msgDiv.style.display = 'block';
      msgDiv.style.backgroundColor = '#e2e3e5';
      msgDiv.style.color = '#383d41';
      msgDiv.innerText = '⏳ 画像ファイルを安全にアップロード中...';
    }

    const getValue = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value || '';
    const getFileInput = (id: string) => document.getElementById(id) as HTMLInputElement;

    const userFolder = `uploads/${currentUserId}`;

    // 1. 本人のドキュメントのアップロード
    let myNumberImageUrl = '';
    const myNumFile = getFileInput('mynumber-image')?.files?.[0];
    if (myNumFile) myNumberImageUrl = await uploadFileToStorage(myNumFile, `${userFolder}/mynumber`);

    let pensionImageUrl = '';
    const pensionFile = getFileInput('pension-image')?.files?.[0];
    if (pensionFile) pensionImageUrl = await uploadFileToStorage(pensionFile, `${userFolder}/pension`);

    let taxSlipImageUrl = '';
    const radioIncomeYes = document.getElementById('radio-income-yes') as HTMLInputElement;
    if (radioIncomeYes?.checked) {
      const taxFile = getFileInput('tax-slip-image')?.files?.[0];
      if (taxFile) taxSlipImageUrl = await uploadFileToStorage(taxFile, `${userFolder}/tax_slip`);

    }
      // 🌟 NEW: 雇用保険の画像アップロード処理を追加！
      let empInsuranceImageUrl = '';
      const empInsFile = getFileInput('emp-insurance-image')?.files?.[0];
      if (empInsFile) empInsuranceImageUrl = await uploadFileToStorage(empInsFile, `${userFolder}/emp_insurance`);

    // 2. 扶養家族のドキュメントアップロード
    const attachedFiles: { docName: string; fileUrl: string }[] = [];
    const radioDepYes = document.querySelector('input[name="has-dependent"][value="yes"]') as HTMLInputElement;
    if (radioDepYes?.checked) {
      const fileInputs = document.querySelectorAll('.dep-file-input') as NodeListOf<HTMLInputElement>;
      for (const input of Array.from(fileInputs)) {
        if (input.files && input.files[0]) {
          const url = await uploadFileToStorage(input.files[0], `${userFolder}/dependent`);
          attachedFiles.push({ docName: input.dataset.docName || '', fileUrl: url });
        }
      }
    }

    // 3. データをまとめる
    let dependentData = null;
    if (radioDepYes?.checked) {
      dependentData = {
        lastNameKanji: getValue('dep-last-name-kanji'),
        firstNameKanji: getValue('dep-first-name-kanji'),
        lastNameKana: getValue('dep-last-name-kana'),
        firstNameKana: getValue('dep-first-name-kana'),
        lastNameRoman: getValue('dep-last-name-roman'),
        firstNameRoman: getValue('dep-first-name-roman'),
        birthdate: getValue('dep-birth'),
        gender: getValue('dep-gender'),
        relationship: getValue('dep-relation'),
        livingStatus: getValue('dep-living'),
        estimatedIncome: Number(getValue('dep-income')),
        hasDisability: (document.getElementById('dep-disability') as HTMLInputElement)?.checked || false,
        currentStatus: getValue('dep-status'),
        startDate: getValue('dep-start-date'),
        attachedFiles: attachedFiles 
      };
    }

    const radioForeign = document.getElementById('radio-foreign') as HTMLInputElement;


    // （employeeDataを作る直前のどこかに、こういう処理を足す）

    const employeeData = {
      lastNameKanji: getValue('last-name-kanji'),
      firstNameKanji: getValue('first-name-kanji'),
      lastNameKana: getValue('last-name-kana'),
      firstNameKana: getValue('first-name-kana'),
      birthdate: getValue('birthdate'),
      gender: getValue('gender'),
      isForeigner: radioForeign?.checked || false,
      foreignDetails: radioForeign?.checked ? {
        lastNameRoman: getValue('last-name-roman'),
        firstNameRoman: getValue('first-name-roman'),
        visaStatus: getValue('visa-status'),
        visaExpiry: getValue('visa-expiry')
      } : null,
      currentAddress: getValue('current-address'),
      registeredAddress: (document.getElementById('address-same-check') as HTMLInputElement)?.checked ? getValue('current-address') : getValue('registered-address'),
      hasPreviousIncome: radioIncomeYes?.checked || false,
      
      myNumber: getValue('mynumber'),
      myNumberImageUrl: myNumberImageUrl,
      pensionNumber: getValue('pension-num'),
      pensionImageUrl: pensionImageUrl,
      taxSlipImageUrl: taxSlipImageUrl,
      willSubmitTaxSlipLater: (document.getElementById('tax-slip-later') as HTMLInputElement)?.checked || false,
      // 🌟 ここを修正！名前を合わせて、画像URLも足す！
      empInsuranceNum: getValue('emp-insurance-num'),
      empInsuranceImageUrl: empInsuranceImageUrl, // 📸 雇用保険の画像URL
      
      commuteRoute: getValue('commute-route'),
      allowances: {
        commute: Number(getValue('commute-allowance')) || 0
      },

      bankInfo: {
        bankName: getValue('bank-name'),
        branchName: getValue('branch-name'),
        accountType: getValue('account-type'),
        accountNumber: getValue('account-num')
      },

      hasDependent: radioDepYes?.checked || false,
      dependent: dependentData,
      updatedAt: new Date()
    };

    await setDoc(doc(db, 'users', currentUserId), employeeData, { merge: true });
    
    // 🌟 ここを修正！ステータスを戻すと同時に、差し戻しフラグをへし折る！
    await updateDoc(doc(db, 'invites', currentUserEmail), { 
        status: '確認待ち',
        isRemanded: false,  // ✨ これがバナーを消去する魔法の1行
        remandReason: ""    // ✨ 次のために理由も空っぽにリセットしておく
    });

    // 🌟 --- ここから追加：扶養追加があればライフイベントに申請を自動生成 ---
    if (radioDepYes?.checked && dependentData) {
      try {
          await addDoc(collection(db, "life_events"), {
              // 1. IDと名前（TypeScriptエラーを回避するため、安全な取り方に変更）
              userId: currentUserId,
              userEmail: currentUserEmail, // 過去データに合わせて念のため追加
              employeeId: (employeeData as any).employeeId || currentUserId.substring(0, 6),
              empName: `${employeeData.lastNameKanji} ${employeeData.firstNameKanji}`,
              
              // 🌟 修正1: ライフイベントタブの正解は「未承認」でした！
              status: "未承認", 
              
              // 🌟 修正2: 過去の成功データに合わせて "other" に統一
              eventType: "other", 
              event: "family_add", // 承認タスク生成用（残しておきます）
              
              eventDate: dependentData.startDate || new Date().toISOString().split('T')[0],
              eventTitle: "👔 家族・扶養追加の申請",
              dependent: dependentData,
              
              // 🌟 修正3: 【超重要】文字列(toISOString)ではなく、純粋な Date オブジェクトで保存する！
              createdAt: new Date()
          });
          console.log("✅ 扶養追加のライフイベント申請を自動発行しました！");
      } catch (error) {
          console.error("ライフイベント連携エラー:", error);
      }
  }
  // 🌟 --- ここまで ---



    if (msgDiv) {
      msgDiv.style.backgroundColor = '#d4edda';
      msgDiv.style.color = '#155724';
      msgDiv.innerText = '✓ 提出が完了しました！書類画像も安全に送信されました。';
    }
    infoForm.style.display = 'none'; 


    // ① ダッシュボードへ移動ボタンを出現させる（display: none を block にする）
    const toDashboardBtn = document.getElementById('btn-to-dashboard');
    if (toDashboardBtn) {
      toDashboardBtn.style.display = 'block';
    }

    // ② もう一度「提出」を押されないように、元の提出ボタンを隠す（親切設計！）
    const submitBtn = document.querySelector('.btn-submit') as HTMLButtonElement;
    if (submitBtn) {
      submitBtn.style.display = 'none';
    }

  } catch (error) {
    console.error("提出エラー:", error);
    if (msgDiv) {
      msgDiv.style.backgroundColor = '#f8d7da';
      msgDiv.style.color = '#721c24';
      msgDiv.innerText = '送信に失敗しました。';
    }
  }
});

// ==========================================
// 🛡️ 最強の半角数字バリデーション（全角→半角自動変換）
// ==========================================
document.querySelectorAll('.strict-number').forEach(input => {
  input.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      
      // 1. 全角数字（０-９）を半角数字（0-9）に変換
      let val = target.value.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
      
      // 2. 数字（0-9）以外をすべて空文字に置換（ハイフンや文字を強制消去）
      val = val.replace(/\D/g, '');
      
      // 3. 画面に反映
      target.value = val;
  });
});