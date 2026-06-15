import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, where, getDocs, getDoc, doc, orderBy, updateDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db,storage } from './config/firebase.js'; // ※ご自身の環境に合わせてパスを調整してください
// 🌟 ログイン中の従業員IDを保持するグローバル変数
let loggedInEmployeeId = "";
const greetingEl = document.getElementById('user-greeting');
const payslipsListEl = document.getElementById('my-payslips-list');
const logoutBtn = document.getElementById('btn-logout');

// 🚪 ログアウト処理
logoutBtn?.addEventListener('click', async () => {
  if (confirm('ログアウトしますか？')) {
    await signOut(auth);
    window.location.href = '/index.html'; // ログイン画面（初期画面）へ戻す
  }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
      // 🌟 従業員自身のメールアドレスを使って個人情報入力モーダルを起動！
      if (user.email) {
             initPersonalInfoModal(user.email);
             }
      if (greetingEl) {
        // 🌟 【修正】Firestoreからユーザー情報を取得して名前を表示する！
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const fullName = `${userData.lastNameKanji || ''} ${userData.firstNameKanji || ''}`.trim();
            greetingEl.textContent = `${fullName || '従業員'} さん、お疲れ様です！`;
            // 👇 🌟 ここに1行追加！名前を渡して通知を取りに行く！
            loggedInEmployeeId = userData.employeeId;
           await loadMyNotifications(fullName);
          } else {
            greetingEl.textContent = `従業員 さん、お疲れ様です！`;

          }
        } catch (err) {
          greetingEl.textContent = `従業員 さん、お疲れ様です！`;
        }
      }
  
      // 給与明細の取得
      await loadMyPayslips(user.uid);
      // お知らせの取得（後で実装します）
      // await loadMyNotifications(user.uid);
  
    } else {
      window.location.href = '/index.html';
    }
  });

// 📄 給与明細データを取得して画面に表示する関数
async function loadMyPayslips(uid: string) {
  if (!payslipsListEl) return;
  
  try {
    // 💡 検索条件：「payslips」コレクションの中から、userId が自分のUIDと一致するものだけを探す！
    const q = query(
      collection(db, 'payslips'),
      where('userId', '==', uid)
    );
    
    const querySnapshot = await getDocs(q);

    // データが1件も無かった場合
    if (querySnapshot.empty) {
      payslipsListEl.innerHTML = '<p style="color: #666; padding: 10px;">現在、公開されている給与明細はありません。</p>';
      return;
    }

    // データがあった場合は、HTMLを組み立てて表示する
    let html = '';
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // 総支給額をざっくり計算（基本給 ＋ 役職手当 ＋ 住宅手当）
      const totalPay = (data.baseAmount || 0) + (data.roleAllowance || 0) + (data.housingAllowance || 0);
      
      html += `
        <div class="slip-list-item">
          <div>
            <strong style="font-size: 16px;">${data.targetMonth}度 給与明細</strong>
            <p style="margin: 5px 0 0; font-size: 13px; color: #555;">支給総額: ¥${totalPay.toLocaleString()}</p>
          </div>
          <button class="btn-view-slip" onclick="alert('※明細の詳細ポップアップは次のステップで作ります！')">明細を見る</button>
        </div>
      `;
    });

    payslipsListEl.innerHTML = html; // 画面に流し込む！

  } catch (error) {
    console.error("明細の取得に失敗しました:", error);
    payslipsListEl.innerHTML = '<p style="color: red;">データの読み込みに失敗しました。</p>';
  }
}

// ==========================================
// 🏢 1. 差し戻し監視関数の「宣言」（今ここを追加した状態）
// ==========================================
function listenToRemandStatus(email: string) {
  // 🔍 調査1：そもそもこの関数が実行（呼び出し）されているか？
  console.log("🚀 [1] 監視関数スタート！渡されたメールアドレス:", email);
  const bannerArea = document.getElementById('remand-banner-area');
  // 🔍 調査2：HTMLに「表示用の空箱」がちゃんと存在するか？
  console.log("📦 [2] バナーの空箱（HTML）はあるか？:", bannerArea);
  if (!bannerArea) return;

  onSnapshot(doc(db, 'invites', email), (docSnap) => {
    // 🔍 調査3：Firestoreからデータをちゃんと引っ張ってこれたか？
    console.log("🔥 [3] DBデータ受信:", docSnap.exists() ? docSnap.data() : "データなし！");

      if (docSnap.exists()) {
          const data = docSnap.data();
          // 🔍 調査4：差し戻しフラグは本当に true になっているか？
          console.log("⚠️ [4] 差し戻しフラグの状態 (isRemanded):", data.isRemanded);
          if (data.isRemanded === true) {
              const reasonText = data.remandReason || '入力内容に不備がありました。';
              bannerArea.innerHTML = `
                  <div style="background-color: #fff3cd; border-left: 5px solid #dc3545; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                      <h4 style="margin: 0; color: #dc3545; font-size: 15px; font-weight: bold;">⚠️ 労務担当から差し戻しがありました</h4>
                      <p style="margin: 5px 0 10px 0; font-size: 13px; color: #856404;">以下の理由を確認し、データを修正して再提出してください。</p>
                      <div style="background: #fff; padding: 10px; border: 1px dashed #dc3545; border-radius: 4px; font-size: 14px; color: #d32f2f; font-weight: bold;">
                          📝 理由：${reasonText}
                      </div>
                      <button onclick="window.location.href='employee.html'" style="background-color: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-size: 14px; font-weight: bold; cursor: pointer; transition: 0.2s;">
                        ✏️ 入社手続き画面を開いて修正する ➡️
                    </button>
                  </div>
              `;
          } else {
              bannerArea.innerHTML = '';
          }
      }
  });
}

// 🌟 自分の名前宛ての通知を取得して表示する関数（ごみ箱＆復元機能つき）
async function loadMyNotifications(fullName: string) {
    const notificationListEl = document.getElementById('notification-list');
    if (!notificationListEl) return;
  
    try {
      const q = query(
        collection(db, 'notifications'),
        where('targetEmpName', '==', fullName),
        orderBy('createdAt', 'desc')
      );
      
      onSnapshot(q, (querySnapshot) => {
  
      let activeHtml = ''; // 通常の通知用
      let trashHtml = '';  // ごみ箱用
      let activeCount = 0;
      let trashCount = 0;
  
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const docId = docSnap.id;
        const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString('ja-JP') : '今日';
        const shortTitle = data.title || data.message;
        const longMessage = data.message;
        
        // 🌟 ここがポイント！ごみ箱に入っているかどうかの判定
        const isArchived = data.isArchived === true;
  
        const cardBaseHtml = `
          <div class="notification-card" style="background: ${isArchived ? '#f8f9fa' : '#fff8e1'}; border-left: 4px solid ${isArchived ? '#adb5bd' : '#ffc107'}; padding: 10px 15px; margin-bottom: 10px; border-radius: 4px; transition: 0.3s; ${isArchived ? 'opacity: 0.8;' : ''}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
              <div>
                <span style="font-size: 11px; font-weight: bold; color: ${isArchived ? '#6c757d' : '#b08d00'}; background: ${isArchived ? '#e9ecef' : '#ffeeba'}; padding: 2px 6px; border-radius: 12px;">${isArchived ? 'ごみ箱' : '重要'}</span>
                <span style="font-size: 11px; color: #888; margin-left: 5px;">${dateStr}</span>
              </div>
              
              <div style="display: flex; gap: 10px;">
                ${isArchived 
                  ? `<button class="btn-restore-notif" data-id="${docId}" style="background: none; border: none; cursor: pointer; font-size: 12px; font-weight: bold; color: #0056b3; padding: 0;" title="受信箱に戻す">↩️ 戻す</button>
                     <button class="btn-delete-hard" data-id="${docId}" style="background: none; border: none; cursor: pointer; font-size: 12px; padding: 0; opacity: 0.6;" title="完全に削除する">❌</button>`
                  : `<button class="btn-archive-notif" data-id="${docId}" style="background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.5; padding: 0;" title="ごみ箱へ移動">🗑️</button>`
                }
              </div>
            </div>
            
            <div class="notif-toggle-area" style="cursor: pointer; user-select: none;" title="クリックで詳細を読む">
              <p style="margin: 0; font-size: 13px; color: ${isArchived ? '#666' : '#333'}; font-weight: bold; ${isArchived ? 'text-decoration: line-through;' : ''}">${shortTitle}</p>
            </div>
            
            <div class="notif-detail" style="display: none; margin-top: 12px; font-size: 12px; color: #555; background: #fff; padding: 12px; border-radius: 4px; border: 1px dashed ${isArchived ? '#ccc' : '#e3a008'}; line-height: 1.5;">
              ${longMessage}
            </div>
          </div>
        `;
  
        if (isArchived) {
          trashHtml += cardBaseHtml;
          trashCount++;
        } else {
          activeHtml += cardBaseHtml;
          activeCount++;
        }
      });
  
      // 🌟 HTMLの組み立て（通常リスト ＋ ごみ箱エリア）
      let finalHtml = '';
      if (activeCount === 0) {
        finalHtml += '<p style="color: #888; font-size: 13px;">現在、新しいお知らせはありません。</p>';
      } else {
        finalHtml += activeHtml;
      }
  
      if (trashCount > 0) {
        finalHtml += `
          <div style="margin-top: 15px; border-top: 1px dashed #ccc; padding-top: 10px; text-align: right;">
            <button id="btn-toggle-trash" style="background: none; border: none; color: #6c757d; cursor: pointer; font-size: 12px; text-decoration: underline; font-weight: bold;">
              🗑️ ごみ箱の中を見る (${trashCount}件)
            </button>
          </div>
          <div id="trash-container" style="display: none; margin-top: 10px; padding: 15px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e9ecef;">
            <p style="font-size: 11px; color: #6c757d; margin-top: 0; margin-bottom: 10px;">※ごみ箱の中の通知は、ここで「❌」を押すまで完全に消去されません。</p>
            ${trashHtml}
          </div>
        `;
      }
  
      notificationListEl.innerHTML = finalHtml;
  
      // 🌟 各種ボタンのイベント（クリックアクション）を登録
      // ① 展開トグル
      document.querySelectorAll('.notif-toggle-area').forEach(area => {
        area.addEventListener('click', (e) => {
          const detailEl = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement;
          if (detailEl) detailEl.style.display = detailEl.style.display === 'none' ? 'block' : 'none';
        });
      });
  
      // ② 通常 ➡ ごみ箱へ移動（Soft Delete）
      document.querySelectorAll('.btn-archive-notif').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const targetId = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (targetId) {
            await updateDoc(doc(db, 'notifications', targetId), { isArchived: true });
          }
        });
      });
  
      // ③ ごみ箱 ➡ 通常へ復元（Restore）
      document.querySelectorAll('.btn-restore-notif').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const targetId = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (targetId) {
            await updateDoc(doc(db, 'notifications', targetId), { isArchived: false });
          }
        });
      });
  
      // ④ ごみ箱から完全に削除（Hard Delete）
      document.querySelectorAll('.btn-delete-hard').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const targetId = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (targetId && confirm('この通知を完全に消去しますか？（元に戻せません）')) {
            await deleteDoc(doc(db, 'notifications', targetId));
          }
        });
      });
  
      // ⑤ ごみ箱を開閉するボタン
      const toggleTrashBtn = document.getElementById('btn-toggle-trash');
      const trashContainer = document.getElementById('trash-container');
      if (toggleTrashBtn && trashContainer) {
        toggleTrashBtn.addEventListener('click', () => {
          if (trashContainer.style.display === 'none') {
            trashContainer.style.display = 'block';
            toggleTrashBtn.innerText = `⬆️ ごみ箱を閉じる`;
          } else {
            trashContainer.style.display = 'none';
            toggleTrashBtn.innerText = `🗑️ ごみ箱の中を見る (${trashCount}件)`;
          }
        });
      }
    });
    } catch (error) {
      console.error("通知の取得エラー:", error);
    }
  }


// ==========================================
// 🚀 3. 【ここを追記！】マイページを起動するメイン処理
// ==========================================
// ※ Firebase Auth等でログインユーザーの情報を監視している場所、
// または画面初期化関数（例: initDashboard などの名前になっているかと思います）の中に組み込みます。

// 例①：Firebase Authのログイン監視の中で呼び出す場合
onAuthStateChanged(auth, async (user) => {
  if (user) {
      const userEmail = user.email || ""; // ログインした人のメールアドレス
      const userFullName = user.displayName || "従業員氏名"; // ログインした人の名前

      // 🟢 既存の通知を読み込む（すでにある処理）
      await loadMyNotifications(userFullName);

      // 🔥【ここに追記！】差し戻し監視関数を「実行」する！！
      // これを書くことで、VS Codeの「読み取られることはありません」のエラーが消え去ります！
      listenToRemandStatus(userEmail);
  }
});


// 🌟 従業員が個人情報を自分で更新する機能（健康保険 動的UI＆バリデーション対応版）
export function initPersonalInfoModal(userEmail: string) {
    const btnOpen = document.getElementById('btn-open-personal-info');
    const btnClose = document.getElementById('btn-close-personal-info');
    const btnSave = document.getElementById('btn-save-personal-info') as HTMLButtonElement;
    const modal = document.getElementById('modal-personal-info');
    
    const inputPension = document.getElementById('input-emp-pension') as HTMLInputElement;
    const inputMyNumber = document.getElementById('input-emp-mynumber') as HTMLInputElement;
    
    const selectHealthType = document.getElementById('select-health-type') as HTMLSelectElement;
    const inputHealthSymbol = document.getElementById('input-emp-health-symbol') as HTMLInputElement;
    const hintHealthSymbol = document.getElementById('hint-health-symbol') as HTMLElement;
    const inputHealthNumber = document.getElementById('input-emp-health-number') as HTMLInputElement;
  
    if (!btnOpen || !modal || !btnSave || !btnClose) return;
  
    // 🌟 プルダウンを変更した時に、入力欄の案内文と色を切り替える関数
    const updateHealthUI = () => {
      if (selectHealthType.value === 'kyokai') {
        inputHealthSymbol.placeholder = '例: 12345678';
        hintHealthSymbol.textContent = '※数字のみ入力';
        hintHealthSymbol.style.color = '#d32f2f'; // 赤色で注意喚起
      } else {
        inputHealthSymbol.placeholder = '例: 関東、A、123';
        hintHealthSymbol.textContent = '※漢字・カナ・英数字も可';
        hintHealthSymbol.style.color = '#0288d1'; // 青色で許可をアピール
      }
    };
  
    // プルダウンが操作されたらUIを切り替えるイベントを登録
    if (selectHealthType) {
      selectHealthType.addEventListener('change', updateHealthUI);
    }
  
    // ① ボタンを押したらモーダルを開く
    btnOpen.addEventListener('click', async () => {
      modal.style.display = 'flex';
      inputPension.value = ''; 
      inputMyNumber.value = '';
      if (inputHealthSymbol) inputHealthSymbol.value = '';
      if (inputHealthNumber) inputHealthNumber.value = '';
  
      try {
        const q = query(collection(db, 'users'), where('email', '==', userEmail));
        const snap = await getDocs(q);
        
        const firstDoc = snap.docs[0];
        if (firstDoc) {
          const userData = firstDoc.data();
          inputPension.value = userData?.basicPensionNumber || userData?.pensionNumber || '';
          inputMyNumber.value = userData?.myNumber || '';
          
          if (selectHealthType && userData?.healthInsuranceType) {
            selectHealthType.value = userData.healthInsuranceType;
          } else if (selectHealthType) {
            selectHealthType.value = 'kyokai'; // デフォルトは協会けんぽ
          }
          
          if (inputHealthSymbol) inputHealthSymbol.value = userData?.healthInsuranceSymbol || '';
          if (inputHealthNumber) inputHealthNumber.value = userData?.healthInsuranceNumber || '';
          
          // データをセットしたら、UI（案内文）を最新の状態に更新する
          updateHealthUI();
        }
      } catch (error) {
        console.error("既存データの取得エラー:", error);
      }
    });
  
    // ② キャンセルボタン
    btnClose.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  
    // ③ 🌟 労務へ送信（Firestoreの 'users' をダイレクト更新）
    btnSave.addEventListener('click', async () => {
      const pensionVal = inputPension.value.trim();
      const myNumberVal = inputMyNumber.value.trim();
      const healthTypeVal = selectHealthType ? selectHealthType.value : '';
      const healthSymbolVal = inputHealthSymbol ? inputHealthSymbol.value.trim() : '';
      const healthNumberVal = inputHealthNumber ? inputHealthNumber.value.trim() : '';
  
      // ⛔ 【強力な入力チェック】協会けんぽなのに、数字以外が入力されていたらブロック！
      if (healthTypeVal === 'kyokai' && healthSymbolVal !== '') {
        // 正規表現で「数字（0〜9）以外が含まれていないか」をチェック
        const isNumberOnly = /^[0-9]+$/.test(healthSymbolVal);
        if (!isNumberOnly) {
          alert("【エラー】協会けんぽの場合、記号は「数字のみ」で入力してください。\n組合健保の場合はプルダウンを変更してください。");
          return; // 保存処理をここでストップ！
        }
      }
  
      if (!pensionVal && !myNumberVal && !healthSymbolVal && !healthNumberVal) {
        alert("情報を入力してください。");
        return;
      }
  
      try {
        btnSave.innerText = '送信中...';
        btnSave.style.opacity = '0.7';
  
        const q = query(collection(db, 'users'), where('email', '==', userEmail));
        const snap = await getDocs(q);
  
        if (snap.empty) {
          alert("アカウント情報が見つかりません。");
          return;
        }
  
        // 🌟 Firestoreの自分のデータを書き換える！
        const firstDoc = snap.docs[0];
        if (firstDoc) {
          const userDocRef = doc(db, 'users', firstDoc.id);
          await updateDoc(userDocRef, {
            basicPensionNumber: pensionVal,
            myNumber: myNumberVal,
            healthInsuranceType: healthTypeVal,       // プルダウンの選択肢も保存
            healthInsuranceSymbol: healthSymbolVal,   // 健康保険記号
            healthInsuranceNumber: healthNumberVal    // 健康保険番号
          });
        }
  
        alert("🎉 個人情報を更新しました！\n労務担当者にデータが連携されました。");
        modal.style.display = 'none';
        
      } catch (error) {
        console.error("保存エラー:", error);
        alert("保存中にエラーが発生しました。");
      } finally {
        btnSave.innerText = '保存して送信';
        btnSave.style.opacity = '1';
      }
    });
  }


  // 🌟 要素の取得
// ※ 'btn-address-change' はスクショにある「住所・氏名の変更」ボタンのIDに合わせて変更してください
const btnOpenChange = document.getElementById('btn-apply-profile');
const modalChange = document.getElementById('modal-address-name-change');
const btnCloseChange = document.getElementById('btn-close-change-modal');
const btnSubmitChange = document.getElementById('btn-submit-change');

// モーダルを開く
btnOpenChange?.addEventListener('click', () => {
  if (modalChange) modalChange.style.display = 'flex';
});

// モーダルを閉じる
btnCloseChange?.addEventListener('click', () => {
  if (modalChange) modalChange.style.display = 'none';
});

// 🌟 申請ボタンを押したときの処理（Firestoreへ送信）
// 🌟 申請ボタンを押したときの処理（Firestoreへ送信：完全版）
btnSubmitChange?.addEventListener('click', async () => {
    const changeDate = (document.getElementById('input-change-date') as HTMLInputElement).value;
    const newLastName = (document.getElementById('input-new-lastname') as HTMLInputElement).value;
    const newFirstName = (document.getElementById('input-new-firstname') as HTMLInputElement).value;
    
    // 🌟 追加した「郵便番号」「通勤経路」「定期代」のデータを取得！
    const newZip = (document.getElementById('input-new-zip') as HTMLInputElement).value;
    const newAddress = (document.getElementById('input-new-address') as HTMLInputElement).value;
    const newRoute = (document.getElementById('input-new-route') as HTMLInputElement).value;
    const newPass = (document.getElementById('input-new-pass') as HTMLInputElement).value;
  
    if (!changeDate) {
      alert("変更発生日を入力してください。");
      return;
    }
    
    // 実務的バリデーション：住所を入れたなら郵便番号も必須！
    if (newAddress && !newZip) {
      alert("新しい住所の「郵便番号」も入力してください。");
      return;
    }
  
    try {
        // 🌟 ステップ2で保存した、本物のログインユーザーIDを使う！
        const currentEmployeeId = loggedInEmployeeId; 
        
        // 万が一IDが取れていなかった場合のエラー回避
        if (!currentEmployeeId) {
          alert("ユーザー情報が取得できません。ページをリロードしてください。");
          return;
        } // ※テスト用。後で実際のログインユーザーIDにします
      
      // Firestoreの「changeRequests」コレクションに保存
      await addDoc(collection(db, "changeRequests"), {
        employeeId: currentEmployeeId,
        type: "住所・氏名変更",
        changeDate: changeDate,
        newLastName: newLastName,
        newFirstName: newFirstName,
        newZip: newZip,           // 🌟 追加
        newAddress: newAddress,
        newRoute: newRoute,       // 🌟 追加
        newPass: newPass ? Number(newPass) : 0, // 🌟 追加（計算しやすいように数値にしておく）
        status: "pending", // 労務の承認待ち
        createdAt: new Date().toISOString()
      });
  
      alert("申請が完了しました！労務担当者の確認をお待ちください。");
      if (modalChange) modalChange.style.display = 'none';
      
      // 入力欄をリセットする
      (document.getElementById('input-change-date') as HTMLInputElement).value = '';
      (document.getElementById('input-new-lastname') as HTMLInputElement).value = '';
      (document.getElementById('input-new-firstname') as HTMLInputElement).value = '';
      (document.getElementById('input-new-zip') as HTMLInputElement).value = '';
      (document.getElementById('input-new-address') as HTMLInputElement).value = '';
      (document.getElementById('input-new-route') as HTMLInputElement).value = '';
      (document.getElementById('input-new-pass') as HTMLInputElement).value = '';
  
    } catch (error) {
      console.error("申請エラー:", error);
      alert("申請に失敗しました。");
    }
  });



// ==========================================
// 🌟 共通のファイルアップロード関数
// ==========================================
async function uploadFileToStorage(file: File, folderPath: string): Promise<string> {
    const storageRef = ref(storage, `${folderPath}/${Date.now()}_${file.name}`);
    const metadata = { contentType: file.type || 'image/jpeg' };
    const snapshot = await uploadBytes(storageRef, file, metadata);
    return await getDownloadURL(snapshot.ref);
  }  
// ==========================================
// 🌟 ライフイベント（家族情報・出産など）の申請処理
// ==========================================

export function initLifeEventForms() {
    const btnApplyFamily = document.getElementById('btn-apply-family');
    const modalFamily = document.getElementById('modal-life-event-family');
    const btnCloseIcon = document.getElementById('btn-close-family-modal');
    const btnCancelBtn = document.getElementById('btn-cancel-family-modal');
    const btnSubmitFamily = document.getElementById('btn-submit-family-event') as HTMLButtonElement;
    const radioEventTypes = document.getElementsByName('family-event-type');
    
    
    // 各入力セクション
    const formBirthSection = document.getElementById('form-birth-section');
    const formReinstatementSection = document.getElementById('form-reinstatement-section');
    const formFamilySection = document.getElementById('form-family-section');
    const formFamilyRemoveSection = document.getElementById('form-family-remove-section'); // 🌟 新規

    // ==========================================
    // 🌟 扶養家族の必要書類・自動計算ロジック（入社ウィザードから移植！）
    // ==========================================
    const calculateRequiredDocs = () => {
        const statusSelect = document.getElementById('dep-status') as HTMLSelectElement;
        const livingSelect = document.getElementById('dep-living') as HTMLSelectElement;
        const docNavArea = document.getElementById('doc-nav-area') as HTMLDivElement;
        const docUploadContainer = document.getElementById('doc-upload-container') as HTMLDivElement;
  
        if (!statusSelect || !livingSelect || !docNavArea || !docUploadContainer) return;
  
        const status = statusSelect.value;
        const living = livingSelect.value;
        const requiredDocs = new Set<string>();
  
        // 条件判定（スクショの神ロジック完全再現）
        if (status === '直近で退職/失業保険終了') requiredDocs.add('退職証明書 または 離職票（1・2）のコピー');
        if (status === '16歳以上の学生') requiredDocs.add('学生証のコピー または 在学証明書');
        if (status === '継続して無職/パート') requiredDocs.add('最新の非課税証明書（または課税証明書）');
        if (status === '年金受給者') requiredDocs.add('年金振込通知書 および 年金額改定通知書');
        if (living === '別居') requiredDocs.add('仕送りしている通帳のコピー（直近の送金実績が分かるもの）');
  
        if (requiredDocs.size > 0) {
          docNavArea.style.display = 'block'; // 表示する
          docUploadContainer.innerHTML = ''; // 一旦クリア
          
          requiredDocs.forEach((docName) => {
            const itemDiv = document.createElement('div');
            itemDiv.style.background = '#fff';
            itemDiv.style.padding = '12px';
            itemDiv.style.borderRadius = '4px';
            itemDiv.style.border = '1px solid #b3d7ff';
            itemDiv.innerHTML = `
              <div style="font-size: 13px; font-weight: bold; color: #0056b3; margin-bottom: 6px;">📄 ${docName}</div>
              <input type="file" class="dep-file-input" data-doc-name="${docName}" style="width: 100%;">
            `;
            docUploadContainer.appendChild(itemDiv);
          });
        } else {
          docNavArea.style.display = 'none'; // 不要な場合は隠す
          docUploadContainer.innerHTML = '';
        }
      };
  
      // セレクトボックスが変更されたら、自動計算を走らせる
      document.getElementById('dep-status')?.addEventListener('change', calculateRequiredDocs);
      document.getElementById('dep-living')?.addEventListener('change', calculateRequiredDocs);
      // ==========================================



    // モーダル開閉
    btnApplyFamily?.addEventListener('click', () => { if (modalFamily) modalFamily.style.display = 'flex'; });
    const closeModal = () => { if (modalFamily) modalFamily.style.display = 'none'; };
    btnCloseIcon?.addEventListener('click', closeModal);
    btnCancelBtn?.addEventListener('click', closeModal);
  
  
    // ③ ラジオボタン切り替え制御（4つのセクション）
    radioEventTypes.forEach(radio => {
        radio.addEventListener('change', (e) => {
        const val = (e.target as HTMLInputElement).value;
        if (formBirthSection) formBirthSection.style.display = val === 'birth' ? 'block' : 'none';
        if (formReinstatementSection) formReinstatementSection.style.display = val === 'reinstatement' ? 'block' : 'none';
        if ((val === 'marriage' || val === 'other') && formFamilySection) formFamilySection.style.display = 'block';
        if ((val === 'marriage' || val === 'other') === false) if (formFamilySection) formFamilySection.style.display = 'none';
        if (formFamilyRemoveSection) formFamilyRemoveSection.style.display = val === 'remove_family' ? 'block' : 'none';
        });
    });
  
    // 🌟 喪失用の神ロジック（就職なら新しい保険証を要求）
    document.getElementById('remove-dep-reason')?.addEventListener('change', (e) => {
        const reason = (e.target as HTMLSelectElement).value;
        const removeDocNav = document.getElementById('remove-doc-nav-area');
        const removeDocContainer = document.getElementById('remove-doc-upload-container');
        
        if (reason.includes('就職') && removeDocNav && removeDocContainer) {
          removeDocNav.style.display = 'block';
          removeDocContainer.innerHTML = `
            <div style="background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #f5c6cb;">
              <div style="font-size: 13px; font-weight: bold; color: #721c24; margin-bottom: 6px;">📄 新しい健康保険証のコピー（就職先の証明用）</div>
              <input type="file" class="dep-file-input" data-doc-name="就職先健康保険証のコピー" style="width: 100%;">
            </div>`;
        } else if (removeDocNav) {
          removeDocNav.style.display = 'none';
        }
      });


    // ④ 🚀 送信ボタンの処理（Firestoreへ保存）
    btnSubmitFamily?.addEventListener('click', async () => {
      const user = auth.currentUser;
      if (!user) {
        alert("ログイン情報が取得できません。再ログインしてください。");
        return;
      }
  
      const selectedType = (document.querySelector('input[name="family-event-type"]:checked') as HTMLInputElement)?.value;
      
      let eventData: any = {
        userId: user.uid,
        userEmail: user.email,
        employeeId: loggedInEmployeeId || '',
        eventType: selectedType,
        status: '未承認',
        createdAt: serverTimestamp()
      };


      // 👶 出産の場合
      if (selectedType === 'birth') {
        const birthDate = (document.getElementById('input-birth-date') as HTMLInputElement)?.value;
        if (!birthDate) return alert("⚠️ 出産予定日を入力してください。");

        // 🌟【新規追加】画面から「休業開始日」と「終了予定日」の入力を読み取る
        const startDate = (document.getElementById('input-leave-start') as HTMLInputElement)?.value;
        const endDate = (document.getElementById('input-leave-end') as HTMLInputElement)?.value;

        // 画面でチェックされているサポートオプションを取得
        const checks = document.querySelectorAll('.birth-support-check:checked');
        const options = Array.from(checks).map((cb: any) => cb.value);

        // 🚨【安全装置】産休免除、または育休免除にチェックがあるのに、日付が未入力ならガードする
        const needsDates = options.includes('sankyu_exemption') || options.includes('exemption');
        if (needsDates && (!startDate || !endDate)) {
          return alert("⚠️ 社会保険料の免除を申請する場合は、「休業開始日」と「休業終了予定日」を必ず入力してください。");
        }

        eventData.eventTitle = '👶 出産・育休の申請';
        eventData.eventDate = birthDate; // 出産予定日
        eventData.supportOptions = options;

        // 🌟【新規追加】Firestoreに送信するデータオブジェクトに、2つの日付をドッキング！
        eventData.startDate = startDate || "";
        eventData.endDate = endDate || "";
      }
      // 🔙 復職の場合
      else if (selectedType === 'reinstatement') {
        const returnDate = (document.getElementById('input-reinstatement-date') as HTMLInputElement)?.value;
        if (!returnDate) return alert("⚠️ 復職予定日を入力してください。");
        eventData.eventTitle = '🔙 復職（育休の終了）の申請';
        
        const childName = (document.getElementById('input-child-name') as HTMLInputElement)?.value;
        const childDob = (document.getElementById('input-child-dob') as HTMLInputElement)?.value;
        eventData.eventDate = returnDate;
        eventData.childName = childName || '';
        eventData.childBirthDate = childDob || '';
      }
      // 💍 結婚 または 🏫 その他の家族追加の場合（🌟 新規追加）
      else if (selectedType === 'marriage' || selectedType === 'other') {
        eventData.eventTitle = selectedType === 'marriage' ? '💍 結婚・配偶者扶養の申請' : '🏫 家族・扶養追加の申請';
        
        // 入力された家族情報を取得して eventData にまとめる
        eventData.dependent = {
          lastNameKanji: (document.getElementById('dep-last-name-kanji') as HTMLInputElement)?.value || '',
          firstNameKanji: (document.getElementById('dep-first-name-kanji') as HTMLInputElement)?.value || '',
          lastNameKana: (document.getElementById('dep-last-name-kana') as HTMLInputElement)?.value || '',
          firstNameKana: (document.getElementById('dep-first-name-kana') as HTMLInputElement)?.value || '',
          birthDate: (document.getElementById('dep-birth') as HTMLInputElement)?.value || '',
          relation: (document.getElementById('dep-relation') as HTMLSelectElement)?.value || '',
          income: (document.getElementById('dep-income') as HTMLInputElement)?.value || '',
          livingStatus: (document.getElementById('dep-living') as HTMLSelectElement)?.value || ''
        };

        // 必須チェック（名前だけは入れてもらう）
        if (!eventData.dependent.lastNameKanji || !eventData.dependent.firstNameKanji) {
          return alert("⚠️ 追加するご家族の氏名を入力してください。");
        }
      }
  
        // 🌟🌟 扶養から外す（喪失）場合のデータ回収 🌟🌟
        else if (selectedType === 'remove_family') {
            const empName = (document.getElementById('remove-dep-select') as HTMLSelectElement)?.value;
            const reason = (document.getElementById('remove-dep-reason') as HTMLSelectElement)?.value;
            const removeDate = (document.getElementById('remove-dep-date') as HTMLInputElement)?.value;
            
            // 👇 ここを追加！
            const cardReturn = (document.getElementById('remove-dep-card-return') as HTMLSelectElement)?.value;

            if (!empName || !reason || !removeDate || !cardReturn) {
            return alert("⚠️ 対象者、理由、喪失日、保険証の状況をすべて入力してください。");
            }

            eventData.eventTitle = '👋 扶養家族の削除（資格喪失）申請';
            eventData.eventDate = removeDate; // 喪失日
            eventData.removeReason = reason;
            eventData.targetFamilyName = empName;
            eventData.cardReturnStatus = cardReturn; // 👈 労務ダッシュボードに送る
        }


      try {
        btnSubmitFamily.innerText = '⏳ 送信中...';
        btnSubmitFamily.disabled = true;

        // 🌟🌟 1. 添付ファイルのアップロード処理 🌟🌟
        const attachedFiles: { docName: string; fileUrl: string }[] = [];
        // 画面上に表示されている（hiddenになっていない）ファイル入力欄をすべて取得
        const fileInputs = document.querySelectorAll('.dep-file-input') as NodeListOf<HTMLInputElement>;
        
        for (const input of Array.from(fileInputs)) {
            const docNavArea = input.closest('#doc-nav-area, #remove-doc-nav-area') as HTMLElement | null;
            if (docNavArea && (docNavArea.style.display === 'block' || docNavArea.getAttribute('style')?.includes('display: block'))) {
              if (input.files && input.files[0]) {
                const url = await uploadFileToStorage(input.files[0], `life_events/${user.uid}`);
                attachedFiles.push({ docName: input.getAttribute('data-doc-name') || '添付書類', fileUrl: url });
              }
            }
          }

        // アップロードしたファイルのURLリストをイベントデータに追加
        if (attachedFiles.length > 0) {
          eventData.attachedFiles = attachedFiles;
        }

        // 🌟🌟 2. Firestoreにすべてまとめて保存！ 🌟🌟
        await addDoc(collection(db, 'life_events'), eventData);
        alert('🎉 労務への申請が完了しました！');
        closeModal();
        btnSubmitFamily.innerText = '🚀 この内容で労務に申請する';
        btnSubmitFamily.disabled = false;
  
      } catch (error) {
        console.error(error);
        alert("❌ 申請に失敗しました。");
        btnSubmitFamily.disabled = false;
      }
    });
}
  

// ==========================================
// 🌟 💳 保険証再発行モーダルの制御ロジック
// ==========================================
export function initReissueInsuranceForm() {
    // 1. メニューのボタンを押したらモーダルを開く
    const btnApplyLost = document.getElementById('btn-apply-lost');
    const modalReissue = document.getElementById('modal-reissue-insurance');

    if (btnApplyLost && modalReissue) {
        btnApplyLost.addEventListener('click', () => {
            modalReissue.style.display = 'flex';
        });
    }

    // 2. 申請理由の選択肢に合わせて、下の注意書きを切り替えるギミック
    const reissueReason = document.getElementById('reissue-reason') as HTMLSelectElement;
    const policeSec = document.getElementById('police-report-section');
    const brokenSec = document.getElementById('broken-card-section');

    if (reissueReason && policeSec && brokenSec) {
        reissueReason.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value;
            
            if (val === '紛失' || val === '盗難') {
                policeSec.style.display = 'block';
                brokenSec.style.display = 'none';
            } else if (val === 'き損') {
                policeSec.style.display = 'none';
                brokenSec.style.display = 'block';
            } else {
                policeSec.style.display = 'none';
                brokenSec.style.display = 'none';
            }
        });
    }

    // 3. 🌟 フォーム送信時の処理（Firebaseへ保存）
    const formReissue = document.getElementById('form-reissue-insurance') as HTMLFormElement;
    
    if (formReissue) {
        formReissue.addEventListener('submit', async (e) => {
            e.preventDefault(); // 画面の再読み込みを防ぐ

            // 🌟 修正：FirebaseのAuth機能から確実に現在のユーザーを取得する
            if (!auth.currentUser) {
                alert("ログイン情報が取得できません。もう一度ログインしてください。");
                return;
            }

            const currentUserId = auth.currentUser.uid;
            
            // usersコレクションから本人の最新情報を取得
            const userSnap = await getDoc(doc(db, 'users', currentUserId));
            const userData = userSnap.exists() ? userSnap.data() : {};
            
            const employeeId = userData.employeeId || currentUserId.substring(0, 6);
            const empName = `${userData.lastNameKanji || ''} ${userData.firstNameKanji || ''}`.trim() || '氏名不明';

            // フォームの入力値を取得
            const reason = (document.getElementById('reissue-reason') as HTMLSelectElement).value;
            const date = (document.getElementById('reissue-date') as HTMLInputElement).value;
            const police = (document.getElementById('reissue-police') as HTMLSelectElement).value;
            const memo = (document.getElementById('reissue-memo') as HTMLTextAreaElement).value;

            try {
                // Firebaseに「未承認」で追加！
                // Firebaseに「未承認」で追加！
                await addDoc(collection(db, "life_events"), {
                    userId: currentUserId,         // 🌟 authから取ったID
                    employeeId: employeeId,        // 🌟 DBから取った社員番号
                    empName: empName,              // 🌟 DBから取った氏名
                    status: "未承認",
                    eventType: "other", 
                    event: "insurance_reissue",
                    eventDate: date,
                    eventTitle: "💳 保険証の再発行申請",
                    dependent: {
                        reason: reason,
                        policeReport: reason === '紛失' || reason === '盗難' ? police : "不要",
                        memo: memo
                    },
                    createdAt: new Date()
                });

                alert("💳 保険証の再発行申請を送信しました！人事の確認をお待ちください。");
                
                // モーダルを閉じてフォームをリセット
                if (modalReissue) modalReissue.style.display = 'none';
                formReissue.reset();
                if (policeSec) policeSec.style.display = 'none';
                if (brokenSec) brokenSec.style.display = 'none';

            } catch (error) {
                console.error("保険証再発行申請エラー:", error);
                alert("申請の送信に失敗しました。時間をおいて再度お試しください。");
            }
        });
    }
}
// ==========================================
// 🚪 退社ウィザードの制御
// ==========================================
export function initResignationForm() {
    // 1. モーダルを開く処理
    const btnOpenResign = document.getElementById('btn-open-resignation');
    const modalResign = document.getElementById('modal-resignation');

    if (btnOpenResign && modalResign) {
        btnOpenResign.addEventListener('click', (e) => {
            e.preventDefault();
            modalResign.style.display = 'flex';
        });
    }

    // 2. 🌟 フォーム送信時の処理（Firebaseへ保存）
    const formResignation = document.getElementById('form-resignation') as HTMLFormElement;
    
    if (formResignation) {
        formResignation.addEventListener('submit', async (e) => {
            e.preventDefault(); // 画面の再読み込みを防ぐ

            // FirebaseのAuth機能から確実に現在のユーザーを取得する
            if (!auth.currentUser) {
                alert("ログイン情報が取得できません。もう一度ログインしてください。");
                return;
            }

            const currentUserId = auth.currentUser.uid;
            
            // usersコレクションから本人の最新情報を取得
            const userSnap = await getDoc(doc(db, 'users', currentUserId));
            const userData = userSnap.exists() ? userSnap.data() : {};
            
            const employeeId = userData.employeeId || currentUserId.substring(0, 6);
            const empName = `${userData.lastNameKanji || ''} ${userData.firstNameKanji || ''}`.trim() || '氏名不明';

            // フォームの入力値を取得
            const resignDate = (document.getElementById('resignation-date') as HTMLInputElement).value;
            const returnStatus = (document.getElementById('insurance-return-status') as HTMLSelectElement).value;
            // ラジオボタンの選択値を取得
            const unemploymentSlip = (document.querySelector('input[name="unemployment-slip"]:checked') as HTMLInputElement)?.value;

            try {
                // Firebaseに「未承認」で追加！
                await addDoc(collection(db, "life_events"), {
                    userId: currentUserId,
                    employeeId: employeeId,
                    empName: empName,
                    status: "未承認",
                    eventType: "other", 
                    event: "resignation", // 🌟 退社手続き用の目印
                    eventDate: resignDate, // 退職日をセット
                    eventTitle: "🚪 退社手続き（資格喪失）の申請",
                    dependent: {
                        resignDate: resignDate,
                        insuranceReturn: returnStatus,
                        unemploymentSlip: unemploymentSlip
                    },
                    createdAt: new Date()
                });

                alert("🚪 退社手続きの申請を送信しました。人事業務の進行をお待ちください。");
                
                // モーダルを閉じてフォームをリセット
                if (modalResign) modalResign.style.display = 'none';
                formResignation.reset();

            } catch (error) {
                console.error("退社申請エラー:", error);
                alert("申請の送信に失敗しました。時間をおいて再度お試しください。");
            }
        });
    }
}

 // 家族データを取得して表示する関数（エラー解消版）
// デバッグ版：データが来ない原因を突き止める関数
// ==========================================
// 🌟 家族データを取得して表示 ＋ 喪失プルダウンに自動セット
// ==========================================
async function loadFamilyMembers(userId: string) {
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      const userData = userDoc.data();
      const dependent = userData?.dependent; 
  
      const container = document.getElementById('modal-current-family-list');
      const removeSelect = document.getElementById('remove-dep-select') as HTMLSelectElement;
      
      if (container) {
        if (!dependent) {
          container.innerHTML = '<p style="color: #666; font-size: 13px; margin: 0;">現在、登録されている扶養家族はいません。</p>';
          if (removeSelect) removeSelect.innerHTML = '<option value="">対象の扶養家族がいません</option>';
        } else {
          // ① モーダル上部に綺麗に表示
          container.innerHTML = `
            <div style="padding: 8px; background: #fff; border-radius: 4px; border: 1px solid #ccc; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong>${dependent.lastNameKanji || ''} ${dependent.firstNameKanji || ''}</strong> 
                <span style="color: #0056b3; font-weight: bold;">(${dependent.relationship || '不明'})</span>
              </div>
              <div style="color: #555;">生年月日: ${dependent.birthdate || '未登録'}</div>
            </div>
          `;
  
          // ② 👋 扶養から外すプルダウン（Select）に動的に名前を流し込む！
          if (removeSelect) {
            const fullName = `${dependent.lastNameKanji} ${dependent.firstNameKanji}`;
            removeSelect.innerHTML = `
              <option value="">対象者を選択してください</option>
              <option value="${fullName}" data-relation="${dependent.relationship}">${fullName} (${dependent.relationship})</option>
            `;
          }
        }
      }
    } catch (error) {
      console.error("家族データの取得に失敗しました:", error);
    }
  }



// 👇👇👇 🌟 ここを書き換え！ログイン状態を見張って確実にUIDを渡す 🌟 👇👇👇
auth.onAuthStateChanged((user) => {
    if (user) {
      console.log("🔥 ログイン中のユーザーを正確に検知しました。UID:", user.uid);
      loadFamilyMembers(user.uid);
    } else {
      console.log("⚠️ ログイン情報がまだ無いため、暫定のIDを使用します。");
      const currentUserId = localStorage.getItem('uid') || '0C8JtAnQC2ehgF1iyLzvB3IHjTh2'; 
      loadFamilyMembers(currentUserId);
    }
  });

  // 🌟 ファイルの最後で忘れずに関数を実行する！
  initLifeEventForms();
  initReissueInsuranceForm();
  initResignationForm();

