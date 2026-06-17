import { signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, serverTimestamp, collection, getDocs, updateDoc, writeBatch, getDoc, addDoc, query, where, onSnapshot } from 'firebase/firestore';
import emailjs from '@emailjs/browser';
import { auth, db } from './config/firebase.js';
import { calculateSocialInsurance, DEFAULT_RATES } from './insuranceMaster.js';
import { initEmployeeMasterUI } from './employeeMaster.js';
import { PREFECTURE_HEALTH_RATES } from './insuranceMaster.js';
import { initLifeEventUI } from './tab-life-event.js';
import Encoding from 'encoding-japanese';
// =================================================================
// 🛡️ セキュリティガード＆会社ID強制ロック（最強版）
// =================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // ログインしていない人は強制送還
        alert('セッションが切れました。もう一度ログインしてください。');
        window.location.href = '/index.html';
    }
    else {
        // 🌟 【最強ガード】ログイン中なら、必ずデータベースから「その人の本当の会社ID」を取得する！
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists() && userDoc.data().companyId) {
                const realCompanyId = userDoc.data().companyId;
                // ブラウザの記憶がどうなっていようが、強制的に「本当の会社ID」で上書きロックする！
                localStorage.setItem('current_company_id', realCompanyId);
                console.log("🔓 ログイン確認完了＆会社IDロック:", realCompanyId);
                // 🌟 ロックが完了してから、安全に会社情報を読み込む！（順番が超大事）
                loadCompanySettings();
            }
            else {
                console.warn("会社IDが見つかりません。");
            }
        }
        catch (error) {
            console.error("ユーザー情報の取得エラー:", error);
        }
    }
});
const logoutBtn = document.getElementById('logout-btn');
const inviteForm = document.getElementById('invite-form');
const inviteEmailInput = document.getElementById('invite-email');
const inviteMsg = document.getElementById('invite-msg');
const emailListBody = document.getElementById('email-list-body');
const onboardingListBody = document.getElementById('onboarding-list-body');
// 確認パネルの要素
const reviewPanel = document.getElementById('review-panel');
const reviewEmailTitle = document.getElementById('review-email-title');
const viewName = document.getElementById('view-name');
const viewBirthGender = document.getElementById('view-birth-gender');
const viewAddress = document.getElementById('view-address');
const viewForeigner = document.getElementById('view-foreigner');
const viewNumbers = document.getElementById('view-numbers');
const viewDependentArea = document.getElementById('view-dependent-area');
const btnApprove = document.getElementById('btn-approve');
const btnReject = document.getElementById('btn-reject');
let selectedUserEmail = null;
let currentOnboardingUsers = []; // CSV一括出力のために承認済のユーザーを貯める箱
let currentSubmittedUsers = []; // 💡 追加：一括マスタ異動のために「提出済」のユーザーを貯める箱
// メール送信共通関数
async function sendInviteEmail(email) {
    try {
        await emailjs.send('service_zzdwydd', 'template_8ov0gbq', {
            to_email: email,
            // 👇 バッククォートをやめて、普通のシングルクォートと「+」で連結する確実な方法に変更！
            invite_link: 'http://localhost:5173/?email=' + email
        }, 'C836W6NWAnsVBtBBu');
        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}
// 🌟 タスク名から「従業員向けの親切な通知メッセージ」を生成する関数
// 🌟 タスク名から「従業員向けの適切な通知メッセージ」を生成する関数
function generateNotificationMessage(taskTitle, empName) {
    // 🌟 1. まず「終了（65歳）」が含まれているかチェック！
    if (taskTitle.includes('介護保険') && taskTitle.includes('終了')) {
        return `【お知らせ】まもなく65歳を迎えられますね。来月（または当月）の給与より、介護保険料の給与天引きが終了し、市区町村からの直接徴収に切り替わります。`;
    }
    // 🌟 2. 「終了」が含まれていない介護保険は「開始（40歳）」として扱う！
    if (taskTitle.includes('介護保険')) {
        return `【お知らせ】まもなく40歳を迎えられますね。来月（または当月）の給与より、介護保険料の控除が開始されます。詳細は給与明細をご確認ください。`;
    }
    if (taskTitle.includes('厚生年金喪失')) {
        return `【重要】まもなく70歳を迎えられます。法律により厚生年金の資格喪失手続きが必要となります。労務担当にて手続きを進めておりますので、ご不明点があればご連絡ください。`;
    }
    if (taskTitle.includes('後期高齢者')) {
        return `【重要】まもなく75歳を迎えられます。後期高齢者医療制度への移行に伴い、健康保険の喪失手続きがございます。新しい保険証の受け取り等について、別途ご案内いたします。`;
    }
    // 上記以外（結婚申請など）の場合の汎用メッセージ
    return `【お知らせ】「${taskTitle}」に関する手続きが進行中です。ダッシュボードをご確認ください。`;
}
// ==========================================
// 🔄 タブ切り替え ＆ 状態記憶ロジック
// ==========================================
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        if (tabId) {
            document.getElementById(tabId)?.classList.add('active');
            // 💡 追加：開いたタブのIDをブラウザに暗記させる！
            localStorage.setItem('lastActiveManagerTab', tabId);
        }
    });
});
// 💡 追加：画面がリロードされた時、暗記していたタブを全自動で開き直す！
const savedTabId = localStorage.getItem('lastActiveManagerTab');
if (savedTabId) {
    // 記憶していたタブボタンを探し出して、強制的にクリック（発火）させる
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${savedTabId}"]`);
    if (targetBtn) {
        targetBtn.click();
    }
}
// ==========================================
// 🏢 会社情報のロード（🔥 SaaS完全対応版！）
// ==========================================
async function loadCompanySettings() {
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId)
        return;
    try {
        // 🌟 1. 自分の会社IDのデータをFirebaseから取得！
        const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log("🏢 自分の会社データを読み込みました！", data);
            // 🌟 2. 取得したデータを画面の入力欄にセットする！（ここが抜けていたか古かった部分です）
            document.getElementById('master-company-name').value = data.companyName || '';
            document.getElementById('master-employer-name').value = data.employerName || '';
            // mainBranch（事業所情報）の中身を取り出してセット
            if (data.mainBranch) {
                document.getElementById('master-branch-name').value = data.mainBranch.branchName || '';
                document.getElementById('master-address').value = data.mainBranch.address || '';
                // ハイフン区切りのデータを分割してセット
                if (data.mainBranch.zipCode) {
                    const zipSplit = data.mainBranch.zipCode.split('-');
                    document.getElementById('master-zip1').value = zipSplit[0] || '';
                    document.getElementById('master-zip2').value = zipSplit[1] || '';
                }
                if (data.mainBranch.tel) {
                    const telSplit = data.mainBranch.tel.split('-');
                    document.getElementById('master-tel1').value = telSplit[0] || '';
                    document.getElementById('master-tel2').value = telSplit[1] || '';
                    document.getElementById('master-tel3').value = telSplit[2] || '';
                }
                // 下の段の各種コード類もセット！
                document.getElementById('master-pref-code').value = data.mainBranch.prefCode || '';
                document.getElementById('master-city-code').value = data.mainBranch.cityCode || '';
                document.getElementById('master-pension-symbol').value = data.mainBranch.officeSymbol || '';
                document.getElementById('master-pension-number').value = data.mainBranch.officeNumber || '';
                document.getElementById('master-emp-ins-number').value = data.mainBranch.empInsNumber || '';
            }
            // LocalStorageも最新に更新（念のため）
            localStorage.setItem(`company_master_${currentCompanyId}`, JSON.stringify(data));
        }
        else {
            console.log("会社データがまだありません。新規登録です。");
        }
    }
    catch (e) {
        console.error("会社情報の読み込みエラー:", e);
    }
}
// loadCompanySettings();
// 🌟 追加①：関数の外（ファイルの上の方など）で、カメラの電源スイッチを変数として用意しておく
let unsubscribeInvites = null;
// 一覧読み込み（🔥 リアルタイム監視版に進化！）
// 一覧読み込み（🔥 リアルタイム監視＆SaaSフィルター完全対応版！）
function loadEmployeeList() {
    if (!emailListBody || !onboardingListBody)
        return;
    // 🌟 追加①：ログイン中の自分の「会社ID」をLocalStorageから取得
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId)
        return;
    // 🌟 追加②：魔法のフィルター！「自分の会社の招待状」だけを狙い撃ち！
    const invitesQuery = query(collection(db, 'invites'), where('companyId', '==', currentCompanyId));
    // 🌟 追加②：もしすでに監視カメラが動いていたら、一度停止（キャンセル）する！
    if (unsubscribeInvites) {
        unsubscribeInvites();
    }
    // 🌟 変更③：onSnapshot の戻り値（停止スイッチ）を変数に保存しておく！
    unsubscribeInvites = onSnapshot(invitesQuery, async (querySnapshot) => {
        // 💡 変更があるたびに、一度テーブルの中身を真っさらにする（増殖を防ぐため）
        emailListBody.innerHTML = '';
        onboardingListBody.innerHTML = '';
        currentOnboardingUsers = [];
        currentSubmittedUsers = [];
        try {
            // 🌟 追加③：ユーザーのプロフィール情報も「自分の会社の人」だけに絞る！
            const usersQuery = query(collection(db, 'users'), where('companyId', '==', currentCompanyId));
            const usersSnap = await getDocs(usersQuery);
            const userProfiles = {};
            usersSnap.forEach(doc => {
                userProfiles[doc.id] = doc.data();
                if (doc.data().email)
                    userProfiles[doc.data().email] = doc.data();
            });
            // 監視して取ってきた最新の invites データをループ処理！
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const email = docSnap.id;
                const status = data.status || '未登録';
                // 💡 完了した人はここでスキップ（一覧から消える魔法！）
                if (status === '完了')
                    return;
                if (status === '未登録') {
                    // --- 元々の未登録処理（完全維持！） ---
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
            <td style="padding: 12px 8px; font-weight: bold; color: #555;">${email}</td>
            <td><span style="background-color: #6c757d; color: white; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">⬜️ 未ログイン</span></td>
            <td id="action-cell-${email.replace(/[@.]/g, '')}"></td>
          `;
                    emailListBody.appendChild(tr);
                    const actionCell = document.getElementById(`action-cell-${email.replace(/[@.]/g, '')}`);
                    const btn = document.createElement('button');
                    btn.innerText = '招待メール再送';
                    btn.style.padding = '4px 8px';
                    btn.style.fontSize = '12px';
                    btn.style.cursor = 'pointer';
                    btn.addEventListener('click', async () => {
                        btn.innerText = '送信中...';
                        const success = await sendInviteEmail(email); // 竹高さんのオリジナル関数を維持！
                        alert(success ? '再送しました！' : '送信失敗');
                        btn.innerText = '招待メール再送';
                    });
                    actionCell?.appendChild(btn);
                }
                else {
                    // --- ステータスごとのバッジとテキスト判定（完全維持！） ---
                    let statusBadge = '';
                    let taskText = '';
                    if (status === '入力中') {
                        statusBadge = `<span style="background-color: #007bff; color: white; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">🟦 入力中</span>`;
                        taskText = '従業員がフォーム入力中';
                    }
                    else if (status === '確認待ち') {
                        statusBadge = `<span style="background-color: #ffc107; color: #333; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">🟨 確認待ち</span>`;
                        taskText = '提出あり。要確認・承認';
                    }
                    else if (status === '承認済') {
                        statusBadge = `<span style="background-color: #28a745; color: white; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">🟩 承認済</span>`;
                        taskText = 'e-Gov 一括出力の対象';
                        if (userProfiles[email])
                            currentOnboardingUsers.push(userProfiles[email]);
                    }
                    else if (status === '提出済') {
                        statusBadge = `<span style="background-color: #17a2b8; color: white; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">🟦 提出済</span>`;
                        taskText = '役所の公認待ち';
                        if (userProfiles[email]) {
                            currentSubmittedUsers.push({
                                ...userProfiles[email],
                                targetEmail: email
                            });
                        }
                    }
                    let displayName = email;
                    const uData = userProfiles[email];
                    if (uData && uData.lastNameKanji && uData.firstNameKanji) {
                        displayName = `${uData.lastNameKanji} ${uData.firstNameKanji}<br><span style="font-size:10px; color:#666; font-weight:normal;">${email}</span>`;
                    }
                    const tr = document.createElement('tr');
                    tr.className = 'selectable';
                    tr.innerHTML = `<td style="padding: 12px 8px; font-weight: bold; color: #0056b3;">${displayName}</td><td>${statusBadge}</td><td style="color: #666; font-size: 13px;">${taskText}</td>`;
                    tr.addEventListener('click', () => showReviewPanel(email, status)); // 竹高さんのオリジナル関数を維持！
                    onboardingListBody.appendChild(tr);
                }
            });
        }
        catch (error) {
            console.error("リストのリアルタイム取得エラー:", error);
        }
    });
}
// 💡 【追加】給与計算用の年齢計算ロジック（1日生まれの罠対応）
function calculateAgeForPayroll(birthdateStr, targetYear, targetMonth) {
    if (!birthdateStr)
        return 0;
    const birthDate = new Date(birthdateStr);
    if (isNaN(birthDate.getTime()))
        return 0; // 無効な日付なら0歳
    // 判定基準日は「給与対象月の末日」
    const targetDate = new Date(targetYear, targetMonth, 0);
    // 法律上の「誕生日の前日」を取得
    const legalBirthDate = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate() - 1);
    let age = targetDate.getFullYear() - legalBirthDate.getFullYear();
    // 今年の「誕生日の前日」がまだ来ていなければ、年齢を1つ引く
    const thisYearLegalBirthDate = new Date(targetDate.getFullYear(), legalBirthDate.getMonth(), legalBirthDate.getDate());
    if (targetDate < thisYearLegalBirthDate) {
        age--;
    }
    return age;
}
// 💡 DBの履歴から「指定した年月」に適用すべき料率を取得する！（SaaS対応版）
async function fetchCompanyInsuranceSettings(targetYear, targetMonth) {
    // 🌟 コンソールからいつでも実験できるように window に登録！
    try {
        // 🌟 ログイン中の会社IDを取得！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId)
            return DEFAULT_RATES; // 会社IDがなければデフォルトを返す
        const targetStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
        // 🚨 ここがSaaSの魔法！「自分の会社IDの中にある insurance_history」を見に行く！
        const historyRef = collection(db, 'companies', currentCompanyId, 'insurance_history');
        const querySnapshot = await getDocs(historyRef);
        let settingsList = [];
        querySnapshot.forEach((doc) => {
            settingsList.push({ id: doc.id, ...doc.data() });
        });
        if (settingsList.length > 0) {
            settingsList.sort((a, b) => b.id.localeCompare(a.id));
            const validSetting = settingsList.find(s => s.id <= targetStr);
            if (validSetting) {
                console.log(`🏢 ${currentCompanyId} の ${targetStr} に適用される料率(${validSetting.id}開始)を読み込みました`);
                return {
                    insuranceType: validSetting.insuranceType || 'kyokai',
                    prefecture: validSetting.prefecture || '東京都',
                    healthRate: validSetting.healthRate || 0.0998,
                    healthRateEmp: validSetting.healthRateEmp || 0.0499,
                    healthRateComp: validSetting.healthRateComp || 0.0499,
                    nursingRate: validSetting.nursingRate || 0.0160,
                    nursingRateEmp: validSetting.nursingRateEmp || 0.008,
                    nursingRateComp: validSetting.nursingRateComp || 0.008,
                    pensionRate: 0.1830,
                    childContributionRate: validSetting.childContributionRate || 0.0036,
                    childSupportRateEmp: validSetting.childSupportRateEmp || 0,
                    childSupportRateComp: validSetting.childSupportRateComp || 0
                };
            }
        }
    }
    catch (e) {
        console.error("会社設定の読み込みエラー:", e);
    }
    return DEFAULT_RATES;
}
// ⭕️ 関数の「外側」に書くことで、画面を開いた瞬間にコンソールから呼べるようになります！
window.fetchCompanyInsuranceSettings = fetchCompanyInsuranceSettings;
// ==========================================
// 🔍 詳細パネルの表示 ＆ 一時保存・復元・ロック完全統合エンジン
// ==========================================
async function showReviewPanel(email, status = '') {
    selectedUserEmail = email;
    reviewEmailTitle.innerText = `対象: ${email} (現在のステータス: ${status})`;
    reviewPanel.classList.remove('hidden');
    // 一旦表示をリセット
    viewName.innerText = '未入力';
    viewBirthGender.innerText = '';
    viewAddress.innerText = '';
    viewForeigner.innerText = '';
    viewNumbers.innerText = '';
    viewDependentArea.innerHTML = '<span style="color:#999;">なし</span>';
    try {
        // 🌟 1. 会社IDをローカルストレージから取得して防壁を張る！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId) {
            viewName.innerHTML = '<span style="color:#ffc107;">⚠️ 会社情報が読み込めません。</span>';
            return;
        }
        // 🌟 2. 【超重要】「自社」の従業員だけを絞り込んで取得！！！（他社は絶対に見ない）
        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
        const usersSnapshot = await getDocs(usersQuery);
        let userData = null;
        let targetUserId = null;
        // 🌟 3. 該当ユーザーと、そのドキュメントIDを「自社の中から」特定
        usersSnapshot.forEach((uSnap) => {
            const d = uSnap.data();
            // IDが一致、またはメールアドレスが一致するかチェック
            if (uSnap.id === email || d.email === email) {
                userData = d;
                targetUserId = uSnap.id;
            }
        });
        // 🚫 【削除完了】謎の「見つからなかったら最初のユーザーを表示する」危険なコードは完全消去しました！
        if (!userData) {
            viewName.innerHTML = '<span style="color:#ffc107;">⚠️ 詳細データが見つかりません。</span>';
            return;
        }
        // --------------------------------------------------
        // 1️⃣ 左側：本人の申告データの表示処理（竹高さんの元コードを完全維持）
        // --------------------------------------------------
        viewName.innerHTML = `<strong>${userData.lastNameKanji} ${userData.firstNameKanji}</strong> (${userData.lastNameKana} ${userData.firstNameKana})`;
        viewBirthGender.innerText = `🎂 ${userData.birthdate}  /  👥 ${userData.gender === 'male' ? '男性' : '女性'}`;
        viewAddress.innerHTML = `🏠 現住所: ${userData.currentAddress}<br>📜 住民票: ${userData.registeredAddress}`;
        if (userData.commuteRoute) {
            viewAddress.innerHTML += `<br> 🚃 通勤経路: ${userData.commuteRoute}`;
        }
        if (userData.isForeigner && userData.foreignDetails) {
            viewForeigner.innerText = `✈️ 外国籍 [ローマ字: ${userData.foreignDetails.nameRoman} / 在留資格: ${userData.foreignDetails.visaStatus}]`;
        }
        else {
            viewForeigner.innerText = '';
        }
        let myNumLink = userData.myNumberImageUrl ? `<button class="view-doc-btn" data-title="マイナンバーの確認" data-info="入力されたマイナンバー:<br><strong style='font-size:20px; letter-spacing:2px;'>${userData.myNumber}</strong>" data-url="${userData.myNumberImageUrl}">🔍 確認書類を見る</button>` : '<span style="color:#999; margin-left:10px;">(画像なし)</span>';
        let pensionLink = userData.pensionImageUrl ? `<button class="view-doc-btn" data-title="基礎年金番号の確認" data-info="入力された年金番号:<br><strong style='font-size:20px; letter-spacing:2px;'>${userData.pensionNumber}</strong>" data-url="${userData.pensionImageUrl}">🔍 通知書を見る</button>` : '<span style="color:#999; margin-left:10px;">(画像なし)</span>';
        let taxLink = userData.taxSlipImageUrl ? `<br>📄 源泉徴収票: <button class="view-doc-btn" data-title="源泉徴収票の確認" data-info="前職の源泉徴収票" data-url="${userData.taxSlipImageUrl}">🔍 画像を見る</button>` : (userData.willSubmitTaxSlipLater ? '<br>📄 源泉徴収票: <span style="color:#ffc107; font-weight:bold;">⏳ 後日提出予定</span>' : '');
        // 🌟 NEW: 雇用保険のリンクを追加！（ポップアップの仕組みをそのまま流用）
        // ※ userData.empInsuranceNum や userData.empInsuranceImageUrl の部分は、Firestoreに保存している実際のプロパティ名に合わせてください
        let empInsLink = userData.empInsuranceImageUrl ? `<button class="view-doc-btn" data-title="雇用保険被保険者番号の確認" data-info="入力された雇用保険番号:<br><strong style='font-size:20px; letter-spacing:2px;'>${userData.empInsuranceNum || '未入力'}</strong>" data-url="${userData.empInsuranceImageUrl}">🔍 被保険者証を見る</button>` : '<span style="color:#999; margin-left:10px;">(画像なし)</span>';
        // 🌟 修正: 雇用保険番号の行を間に差し込み！
        viewNumbers.innerHTML = `
        🔢 マイナンバー: ************ (12桁) ${myNumLink}<br>
        💳 年金番号: ${userData.pensionNumber || '未登録'} ${pensionLink}<br>
        🏢 雇用保険番号: ${userData.empInsuranceNum || '未登録'} ${empInsLink}
        ${taxLink}
      `;
        if (userData.hasDependent && userData.dependent) {
            const dep = userData.dependent;
            let fileListHTML = '';
            if (dep.attachedFiles && dep.attachedFiles.length > 0) {
                fileListHTML = '<div style="margin-top:8px; color:#28a745; font-size:12px; font-weight:bold;">📁 添付書類（クリックで確認）:<br>' +
                    dep.attachedFiles.map((f) => `・<button class="view-doc-btn" data-title="扶養確認: ${dep.lastNameKanji}" data-info="対象者: <strong>${dep.lastNameKanji} ${dep.firstNameKanji}</strong><br>続柄: ${dep.relationship}<br>状況: ${dep.currentStatus}" data-url="${f.fileUrl}" style="color:#28a745; text-decoration:underline; border:none; background:none; cursor:pointer; font-size:12px; font-weight:bold; padding:0;">${f.docName}</button>`).join('<br>') + '</div>';
            }
            viewDependentArea.innerHTML = `
          <div style="background: #f0f4f8; padding: 10px; border-radius: 4px; border-left: 4px solid #0056b3;">
            <strong>${dep.lastNameKanji} ${dep.firstNameKanji}</strong> (${dep.relationship})<br>
            🎂 ${dep.birthdate} / 💰 収入見込: ${dep.estimatedIncome.toLocaleString()}円<br>
            📊 状況: ${dep.currentStatus} (${dep.livingStatus})<br>
            📅 扶養開始: ${dep.startDate}
            ${fileListHTML}
          </div>
        `;
        }
        // 書類確認モーダルボタンの紐付け
        document.querySelectorAll('.view-doc-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                openDocViewer(target.dataset.title || '書類確認', target.dataset.info || '', target.dataset.url || '');
            });
        });
        // --------------------------------------------------
        // 2️⃣ 右側：労務入力フォームへの【自動データ復元（ロード）】
        // --------------------------------------------------
        const joinDateInput = document.getElementById('hr-join-date');
        const empTypeInput = document.getElementById('hr-emp-type');
        const baseSalaryInput = document.getElementById('hr-base-salary');
        const roleInput = document.getElementById('hr-allowance-role');
        const familyInput = document.getElementById('hr-allowance-family');
        const housingInput = document.getElementById('hr-allowance-housing');
        const fixedOtInput = document.getElementById('hr-allowance-fixed-ot');
        const commuteInput = document.getElementById('hr-allowance-commute');
        const weeklyInput = document.getElementById('hr-weekly-hours');
        const monthlyInput = document.getElementById('hr-monthly-days');
        const socialInsTypeInput = document.getElementById('hr-social-ins-type');
        const salaryTypeInput = document.getElementById('hr-salary-type');
        if (joinDateInput)
            joinDateInput.value = userData.contractInfo?.startDate || '';
        if (empTypeInput)
            empTypeInput.value = userData.contractInfo?.empType || '正社員';
        if (baseSalaryInput)
            baseSalaryInput.value = userData.baseHealth || '';
        if (roleInput)
            roleInput.value = userData.allowances?.role || '';
        if (familyInput)
            familyInput.value = userData.allowances?.family || '';
        if (housingInput)
            housingInput.value = userData.allowances?.housing || '';
        if (fixedOtInput)
            fixedOtInput.value = userData.allowances?.fixedOt || '';
        if (commuteInput)
            commuteInput.value = userData.allowances?.commute || '';
        if (weeklyInput)
            weeklyInput.value = userData.workingHours?.weekly || '';
        if (monthlyInput)
            monthlyInput.value = userData.workingHours?.monthly || '';
        if (socialInsTypeInput)
            socialInsTypeInput.value = userData.socialInsuranceType || 'regular';
        if (salaryTypeInput)
            salaryTypeInput.value = userData.salaryType || '月給';
        baseSalaryInput?.dispatchEvent(new Event('input'));
        // フォームのロック/解除を切り替える内部関数
        const companyInputSection = document.getElementById('company-input-section');
        const toggleInputs = (isLocked) => {
            if (!companyInputSection)
                return;
            const inputs = companyInputSection.querySelectorAll('input, select, textarea, button');
            inputs.forEach(el => {
                if (el.id !== 'btn-save-contract') { // 一時保存ボタン以外をロック
                    el.disabled = isLocked;
                    el.style.backgroundColor = isLocked ? '#e9ecef' : '';
                    el.style.cursor = isLocked ? 'not-allowed' : '';
                }
            });
        };
        // --------------------------------------------------
        // 3️⃣ 💾 オレンジボタンの【一時保存（下書き）】ロジック
        // --------------------------------------------------
        const btnSaveContract = document.getElementById('btn-save-contract');
        if (btnSaveContract) {
            const newBtnSaveContract = btnSaveContract.cloneNode(true);
            btnSaveContract.parentNode?.replaceChild(newBtnSaveContract, btnSaveContract);
            const isFormLocked = (status === '承認済' || status === '提出済' || status === '完了');
            newBtnSaveContract.disabled = isFormLocked;
            newBtnSaveContract.style.cursor = isFormLocked ? 'not-allowed' : 'pointer';
            newBtnSaveContract.style.opacity = isFormLocked ? '0.5' : '1';
            if (!isFormLocked) {
                newBtnSaveContract.addEventListener('click', async () => {
                    if (!targetUserId)
                        return alert('ユーザーIDが見つかりません。');
                    newBtnSaveContract.innerText = '⏳ 保存中...';
                    try {
                        const baseSalary = Number(baseSalaryInput?.value) || 0;
                        const allowanceRole = Number(roleInput?.value) || 0;
                        const allowanceFamily = Number(familyInput?.value) || 0;
                        const allowanceHousing = Number(housingInput?.value) || 0;
                        const allowanceFixedOt = Number(fixedOtInput?.value) || 0;
                        const totalFixedWage = baseSalary + allowanceRole + allowanceFamily + allowanceHousing + allowanceFixedOt;
                        const insuranceResult = calculateSocialInsurance(totalFixedWage);
                        // 💡 修正：新規フィールド作成でのエラーを防ぐため setDoc(..., {merge:true}) を使用！
                        await updateDoc(doc(db, 'users', targetUserId), {
                            baseHealth: baseSalary,
                            basePension: baseSalary,
                            healthGrade: insuranceResult.healthGrade,
                            pensionGrade: insuranceResult.pensionGrade,
                            contractInfo: {
                                // 🌟 直接HTMLから値を拾う書き方に変更！（変数被りエラー防止）
                                empType: document.getElementById('hr-emp-type')?.value || '正社員',
                                startDate: document.getElementById('hr-join-date')?.value || ''
                            },
                            // 🌟🌟🌟 社会保険区分も直接拾って保存！
                            socialInsuranceType: document.getElementById('hr-social-ins-type')?.value || 'regular',
                            allowances: {
                                role: allowanceRole, family: allowanceFamily,
                                housing: allowanceHousing, fixedOt: allowanceFixedOt,
                                commute: Number(commuteInput?.value) || 0
                            },
                            workingHours: {
                                weekly: Number(weeklyInput?.value) || 0,
                                monthly: Number(monthlyInput?.value) || 0
                            },
                            updatedAt: new Date()
                        }); // 💡 末尾の `{ merge: true }` は updateDoc では不要なので消去！
                        alert('💾 データを一時保存しました！（※まだ承認・ロックされていません）');
                        newBtnSaveContract.innerText = '会社側の契約データを保存する';
                    }
                    catch (e) {
                        console.error(e);
                        alert("保存に失敗しました。");
                        newBtnSaveContract.innerText = '会社側の契約データを保存する';
                    }
                });
            }
        }
        // --------------------------------------------------
        // 4️⃣ 🟩/🟥 緑ボタン（承認）と赤ボタン（差戻し）のワークフロー制御
        // --------------------------------------------------
        const currentBtnApprove = document.getElementById('btn-approve');
        const currentBtnReject = document.getElementById('btn-reject');
        if (currentBtnApprove && currentBtnReject) {
            const newBtnApprove = currentBtnApprove.cloneNode(true);
            const newBtnReject = currentBtnReject.cloneNode(true);
            currentBtnApprove.parentNode?.replaceChild(newBtnApprove, currentBtnApprove);
            currentBtnReject.parentNode?.replaceChild(newBtnReject, currentBtnReject);
            const btnContainer = newBtnApprove.parentElement;
            if (btnContainer)
                btnContainer.style.display = 'flex';
            if (status === '確認待ち') {
                toggleInputs(false); // 編集許可
                newBtnApprove.style.display = 'block';
                // =========================================================
                // 🌟 NEW: パネルを開いた瞬間に、前の人のデータを完全消去する！
                // =========================================================
                const hrSalaryType = document.getElementById('hr-salary-type');
                if (hrSalaryType)
                    hrSalaryType.value = '月給';
                document.getElementById('hr-base-salary').value = '';
                document.getElementById('hr-allowance-role').value = '';
                document.getElementById('hr-allowance-family').value = '';
                document.getElementById('hr-allowance-housing').value = '';
                document.getElementById('hr-fixed-ot-hours').value = '';
                document.getElementById('hr-allowance-fixed-ot').value = '';
                document.getElementById('hr-allowance-commute').value = '';
                // =========================================================
                // =========================================================
                // 🌟🌟🌟 NEW: Firestoreからデータを取ってきて、瞬時に復元する！ 🌟🌟🌟
                // =========================================================
                if (targetUserId) {
                    const docRef = doc(db, 'users', targetUserId);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const userData = snap.data();
                        // 1. 給与区分（日給・時給）を復元
                        if (hrSalaryType)
                            hrSalaryType.value = userData.salaryType || '月給';
                        // 2. 雇用形態を復元
                        const hrEmpType = document.getElementById('hr-emp-type');
                        if (hrEmpType && userData.contractInfo)
                            hrEmpType.value = userData.contractInfo.empType || '正社員';
                        // 3. 基本給を復元（保存時に baseHealth に入れているため、そこから取得）
                        const hrBaseSalary = document.getElementById('hr-base-salary');
                        if (hrBaseSalary)
                            hrBaseSalary.value = userData.baseHealth || '';
                        // 4. 各種手当を復元
                        if (userData.allowances) {
                            document.getElementById('hr-allowance-role').value = userData.allowances.role || '';
                            document.getElementById('hr-allowance-family').value = userData.allowances.family || '';
                            document.getElementById('hr-allowance-housing').value = userData.allowances.housing || '';
                            document.getElementById('hr-allowance-fixed-ot').value = userData.allowances.fixedOt || '';
                            document.getElementById('hr-allowance-commute').value = userData.allowances.commute || '';
                        }
                        // 5. 労働時間（週・月）を復元
                        if (userData.workingHours) {
                            document.getElementById('hr-weekly-hours').value = userData.workingHours.weekly || '';
                            document.getElementById('hr-monthly-days').value = userData.workingHours.monthly || '';
                        }
                    }
                }
                // =========================================================
                newBtnApprove.innerText = '承認する';
                newBtnApprove.style.backgroundColor = '#28a745';
                newBtnReject.style.display = 'block';
                // 承認と一括最終セーブの連動
                newBtnApprove.addEventListener('click', async () => {
                    if (!confirm('入力された契約・給与データをマスタに保存し、承認を確定しますか？'))
                        return;
                    try {
                        const baseSalary = Number(baseSalaryInput?.value) || 0;
                        const allowanceRole = Number(roleInput?.value) || 0;
                        const allowanceFamily = Number(familyInput?.value) || 0;
                        const allowanceHousing = Number(housingInput?.value) || 0;
                        const allowanceFixedOt = Number(fixedOtInput?.value) || 0;
                        const totalFixedWage = baseSalary + allowanceRole + allowanceFamily + allowanceHousing + allowanceFixedOt;
                        const insuranceResult = calculateSocialInsurance(totalFixedWage);
                        if (targetUserId) {
                            // 🌟 修正：承認（本登録）という超重要処理こそ、厳格な updateDoc で幽霊化を完全ブロック！
                            await updateDoc(doc(db, 'users', targetUserId), {
                                // employeeStatus: 'active', // 👈 ここで承認済（在籍）になる
                                baseHealth: baseSalary,
                                basePension: baseSalary,
                                healthGrade: insuranceResult.healthGrade,
                                pensionGrade: insuranceResult.pensionGrade,
                                // 🌟🌟🌟 NEW: ここに追加！給与区分（月給・日給・時給）を保存！
                                salaryType: document.getElementById('hr-salary-type')?.value || '月給',
                                // 🌟 修正：画面から直接最新の値を拾って保存する！
                                contractInfo: {
                                    empType: document.getElementById('hr-emp-type')?.value || '正社員',
                                    startDate: document.getElementById('hr-join-date')?.value || ''
                                },
                                // 🌟🌟🌟 NEW: 社会保険区分も忘れずにマスターへ保存！
                                socialInsuranceType: document.getElementById('hr-social-ins-type')?.value || 'regular',
                                allowances: { role: allowanceRole, family: allowanceFamily, housing: allowanceHousing, fixedOt: allowanceFixedOt, commute: Number(commuteInput?.value) || 0 },
                                workingHours: { weekly: Number(weeklyInput?.value) || 0, monthly: Number(monthlyInput?.value) || 0 },
                                updatedAt: new Date()
                            }); // 💡 末尾の `{ merge: true }` は不要になったので消去！
                        }
                        // 🚨 上の処理でFirebase(users)への給与データ等の保存(setDoc)が完了しています 🚨
                        // 💡 --- ここから追加：Firestoreから従業員の基本情報を引っ張る ---
                        // 1. usersコレクションから、対象従業員のドキュメントを取得する
                        const userDocRef = doc(db, 'users', targetUserId);
                        const userSnap = await getDoc(userDocRef); // ※もしgetDocが未インポートなら一番上で import { getDoc } ... してください
                        let empName = "氏名未設定";
                        let empKana = "";
                        let empDob = "";
                        let empAddress = "";
                        // 2. データが存在すれば、Firestoreのフィールドから値を変数に格納する
                        if (userSnap.exists()) {
                            const userData = userSnap.data();
                            // 🌟 姓(Last)と名(First)を合体させてフルネームを作る！
                            // ※firstNameKanji等は画面外にあると推測して繋げています
                            const sei = userData.lastNameKanji || "";
                            const mei = userData.firstNameKanji || "";
                            empName = `${sei} ${mei}`.trim() || "氏名未設定";
                            const seiKana = userData.lastNameKana || "";
                            const meiKana = userData.firstNameKana || "";
                            empKana = `${seiKana} ${meiKana}`.trim() || "";
                            // 🌟 住所は registeredAddress で保存されていました！
                            empAddress = userData.registeredAddress || "";
                            // 🌟 ここを修正：よくあるキー名を全部探すようにし、ダメなら「1990-01-01」を仮置きする
                            empDob = userData.birthdate || userData.birthDate;
                            // 🌟 デバッグ用にコンソールに出す！
                            console.log("🔥 Firestoreの生年月日生データ:", userData);
                            console.log("🔥 取得した生年月日:", empDob);
                        }
                        // 💡 --- 自動採番ロジック（重複防止版） ---
                        let newEmployeeId = "";
                        // まず、Firestoreのデータ（userData）の中に、すでに社員番号があるかチェック！
                        if (userData && userData.employeeId) {
                            // すでに持っていれば、その番号をそのまま使う（＋1しない！）
                            newEmployeeId = userData.employeeId;
                        }
                        else {
                            // まだ持っていない（新規入社）の場合のみ、新しく番号を発行する！
                            let currentEmployeeSeq = parseInt(localStorage.getItem('hr_employee_sequence') || '0', 10);
                            currentEmployeeSeq += 1;
                            newEmployeeId = currentEmployeeSeq.toString().padStart(6, '0');
                            localStorage.setItem('hr_employee_sequence', currentEmployeeSeq.toString());
                        }
                        // 💡 ------------------------------------
                        // 🌟🌟🌟 ここから追加：Firestoreにも社員番号とメールアドレスを書き込む！ 🌟🌟🌟
                        // ※ userSnap.id は Firestore上のこの従業員のドキュメントIDです
                        await updateDoc(doc(db, 'users', userSnap.id), {
                            employeeId: newEmployeeId,
                            email: email
                        });
                        // 🌟🌟🌟 ここまで追加 🌟🌟🌟
                        // 3. 画面の入力値と、Firestoreから引いてきた情報をガッチャンコする！
                        const completeMasterData = {
                            empId: newEmployeeId,
                            name: empName,
                            kana: empKana,
                            dob: empDob,
                            // 🌟 Firestoreにある pensionNumber を最優先で使うように変更！
                            basicPensionNo: userSnap.exists() ? userSnap.data().pensionNumber : (document.getElementById('input-pension-no')?.value || ""),
                            empInsuranceNo: document.getElementById('input-emp-ins-no')?.value || "",
                            baseSalary: totalFixedWage, // 交通費込みの計算結果
                            address: empAddress,
                            myNumber: ""
                        };
                        // さっき追加したcompleteMasterDataのすぐ下にこれを追加！
                        console.log("🔥 Firestoreから取得した名前:", empName);
                        console.log("🔥 保存するマスターデータ:", completeMasterData);
                        // 4. CSV出力用のローカルマスターにコピーを保存（ミラーリング）
                        let localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                        localMasterDB[empName] = completeMasterData;
                        localStorage.setItem('hr_employee_master', JSON.stringify(localMasterDB));
                        // 💡 --- ここまで追加 ---
                        // 👇 この下に既存の await updateDoc(doc(db, 'invites'... が続きます
                        await updateDoc(doc(db, 'invites', email), { status: '承認済' });
                        alert('🎯 契約・給与データの保存 ＆ 承認が完全完了しました！データは安全にロックされます。');
                        // (); 
                        reviewPanel.classList.add('hidden');
                    }
                    catch (error) {
                        console.error(error);
                        alert("承認に失敗しました。");
                    }
                });
                // 差戻し
                newBtnReject.addEventListener('click', async () => {
                    // 💡 1. confirm ではなく prompt を使い、理由を入力してもらう！
                    const reason = prompt('入力内容に不備があるため、従業員に差し戻します。\n修正してほしい箇所（差し戻し理由）を入力してください：\n\n（例：マイナンバーカードの裏面画像が添付されていません）');
                    // 💡 2. キャンセルを押した場合は中断
                    if (reason === null)
                        return;
                    // 💡 3. 空欄のままOKを押した場合は警告して中断
                    if (reason.trim() === '') {
                        alert('⚠️ 差し戻し理由を入力してください。');
                        return;
                    }
                    try {
                        // 🌟 4. statusを「入力中」に戻しつつ、メッセージもDBに保存する！
                        await updateDoc(doc(db, 'invites', email), {
                            status: '入力中',
                            remandReason: reason, // ✨ 追加！従業員側に表示するテキスト
                            isRemanded: true // ✨ 追加！差し戻し状態であることを示すフラグ
                        });
                        alert('従業員に差し戻しを通知しました。');
                        // loadEmployeeList(); 
                        reviewPanel.classList.add('hidden');
                    }
                    catch (e) {
                        console.error(e);
                    }
                });
            }
            else if (status === '承認済') {
                toggleInputs(true); // 完全ロック
                newBtnReject.style.display = 'none';
                newBtnApprove.style.display = 'block';
                newBtnApprove.innerText = '🔓 承認を解除して編集する';
                newBtnApprove.style.backgroundColor = '#6c757d';
                newBtnApprove.addEventListener('click', async () => {
                    if (!confirm('承認を解除し、編集可能な「確認待ち」ステータスに戻しますか？'))
                        return;
                    try {
                        await updateDoc(doc(db, 'invites', email), { status: '確認待ち' });
                        alert('承認を解除しました。内容を編集できます。');
                        // loadEmployeeList(); 
                        reviewPanel.classList.add('hidden');
                    }
                    catch (e) {
                        console.error(e);
                    }
                });
            }
            else if (status === '提出済') {
                toggleInputs(true); // ロック維持
                newBtnReject.style.display = 'block';
                newBtnReject.innerText = '↩️ 提出をキャンセルして再編集';
                newBtnReject.style.backgroundColor = '#dc3545';
                newBtnApprove.style.display = 'block';
                newBtnApprove.innerText = '🏆 公認完了（従業員マスタへ移行）';
                newBtnApprove.style.backgroundColor = '#0056b3';
                // 🔵 青ボタン：公認完了 ➔ 従業員マスタ（現役フラグ）連動ロジックへ魔改造！
                newBtnApprove.addEventListener('click', async () => {
                    if (!confirm('役所の手続きが完了しましたか？\n確定すると、このメンバーを「正式な従業員一覧」へ異動させます。'))
                        return;
                    try {
                        // 1️⃣ 入社手続き（オンボーディング）のタスクとしては「完了」にする
                        await updateDoc(doc(db, 'invites', email), { status: '完了' });
                        // 2️⃣ 💡 【最重要】従業員マスタ（users）側に、正式な社員になった証のフラグを刻む！
                        if (targetUserId) {
                            await updateDoc(doc(db, 'users', targetUserId), {
                                employeeStatus: 'active', // 👈 これが現役社員マスタの鍵になります！
                                activatedAt: new Date() // 異動完了日
                            });
                        }
                        alert('🏆 手続きがすべて完了しました！\n対象のデータを正式な「従業員マスタ」へ異動（有効化）しました。');
                        loadEmployeeList();
                        reviewPanel.classList.add('hidden');
                    }
                    catch (e) {
                        console.error(e);
                        alert('マスタ移行処理に失敗しました。');
                    }
                });
                // 🔴 赤ボタン：提出を取り消して「確認待ち」に逆戻りさせる処理
                newBtnReject.addEventListener('click', async () => {
                    if (!confirm('役所への提出を取り消し、内容を再度編集できるようにしますか？\n（ステータスが「確認待ち」に戻ります）'))
                        return;
                    try {
                        await updateDoc(doc(db, 'invites', email), { status: '確認待ち' });
                        alert('提出をキャンセルしました。内容を修正してください。');
                        loadEmployeeList();
                        reviewPanel.classList.add('hidden');
                    }
                    catch (e) {
                        console.error(e);
                    }
                });
            }
            else {
                toggleInputs(true);
                if (btnContainer)
                    btnContainer.style.display = 'none';
            }
        }
    }
    catch (error) {
        console.error("詳細取得エラー:", error);
    }
}
// ==========================================
// 🏆 提出済メンバーの「一括マスタ異動（公認完了）」ロジック
// ==========================================
document.getElementById('btn-batch-complete')?.addEventListener('click', async () => {
    if (currentSubmittedUsers.length === 0) {
        alert('現在「提出済（役所の公認待ち）」となっている新入社員はいません。');
        return;
    }
    if (!confirm(`提出済となっている ${currentSubmittedUsers.length} 名を、正式な従業員マスタへ一括で異動（有効化）させますか？`))
        return;
    const btn = document.getElementById('btn-batch-complete');
    const originalText = btn.innerText;
    btn.innerText = '⏳ 一括異動処理中...';
    btn.disabled = true;
    try {
        // 🌟 1. 会社IDをローカルストレージから取得して防壁を張る！
        const currentCompanyId = localStorage.getItem('current_company_id');
        // 🌟 2. 【超重要】「自社」の従業員だけを絞り込んで取得！！！（他社は絶対に見ない）
        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
        const usersSnap = await getDocs(usersQuery);
        for (const emp of currentSubmittedUsers) {
            const targetEmail = emp.targetEmail; // さっき付けた名札
            if (!targetEmail)
                continue;
            // ユーザーID（usersコレクションのドキュメントID）を特定
            let targetUserId = null;
            usersSnap.forEach((uSnap) => {
                const d = uSnap.data();
                if (uSnap.id === targetEmail || d.email === targetEmail) {
                    targetUserId = uSnap.id;
                }
            });
            // 1️⃣ invites（入社手続きタスク） は targetEmail で更新
            await updateDoc(doc(db, 'invites', targetEmail), { status: '完了' });
            // 2️⃣ users（マスタ） は見つかった targetUserId で更新
            if (targetUserId) {
                await updateDoc(doc(db, 'users', targetUserId), {
                    employeeStatus: 'active',
                    activatedAt: new Date()
                });
            }
        }
        alert('🏆 一括異動が完了しました！全員が「従業員一覧」に正式追加されました。');
        window.location.reload();
    }
    catch (error) {
        console.error("一括マスタ異動エラー:", error);
        alert("処理中にエラーが発生しました。");
    }
    finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});
// ==========================================
// 🔍 ドキュメントビューアー（モーダル）の制御ロジック
// ==========================================
const docModal = document.getElementById('doc-viewer-modal');
const modalTitle = document.getElementById('modal-title');
const modalInfo = document.getElementById('modal-info-area');
// 💡 2つの箱を取得
const modalIframe = document.getElementById('modal-iframe');
const modalImg = document.getElementById('modal-img');
const modalClose = document.getElementById('modal-close');
function openDocViewer(title, info, url) {
    if (!docModal)
        return;
    modalTitle.innerText = title;
    modalInfo.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h4 style="color:#0056b3; margin-top:0; border-bottom: 2px solid #0056b3; padding-bottom: 4px;">📝 申告データ</h4>
      <div style="font-size: 14px; line-height: 1.6; color: #333;">
        ${info}
      </div>
    </div>
    <div style="background: #e3f2fd; padding: 12px; border-radius: 4px; font-size: 12px; color: #0056b3;">
      <strong>💡 チェックポイント</strong><br>
      右側の画像（またはPDF）と照らし合わせて、入力間違いや不鮮明な箇所がないか確認してください。
    </div>
  `;
    // 💡 URLに ".pdf" が含まれているかで、表示する箱を自動で切り替える
    const isPdf = url.toLowerCase().includes('.pdf');
    if (isPdf) {
        modalImg.classList.add('hidden');
        modalIframe.classList.remove('hidden');
        modalIframe.src = url;
    }
    else {
        modalIframe.classList.add('hidden');
        modalImg.classList.remove('hidden');
        modalImg.src = url;
    }
    docModal.classList.remove('hidden');
}
// 閉じるボタンの処理
modalClose?.addEventListener('click', () => {
    docModal.classList.add('hidden');
    modalIframe.src = '';
    modalImg.src = ''; // 両方の箱を空にする
});
// 🌟 【完全版】e-Gov提出CSV専用：日付を7桁の和暦数字コードに変換する関数
function toEGovDateCode(dateString) {
    if (!dateString)
        return "";
    const date = new Date(dateString);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    // 🌸 令和 (2019年5月1日〜) -> e-Govコード: 5
    if (y > 2019 || (y === 2019 && m >= 5)) {
        return `5${String(y - 2018).padStart(2, '0')}${mm}${dd}`;
    }
    // 🌿 平成 (1989年1月8日〜2019年4月30日) -> e-Govコード: 4
    else if (y > 1989 || (y === 1989 && (m > 1 || (m === 1 && d >= 8)))) {
        return `4${String(y - 1988).padStart(2, '0')}${mm}${dd}`;
    }
    // 🏢 昭和 (1926年12月25日〜1989年1月7日) -> e-Govコード: 3
    else if (y > 1926 || (y === 1926 && (m === 12 && d >= 25))) {
        return `3${String(y - 1925).padStart(2, '0')}${mm}${dd}`;
    }
    // 🚂 大正 (1912年7月30日〜1926年12月24日) -> e-Govコード: 2
    else if (y > 1912 || (y === 1912 && (m > 7 || (m === 7 && d >= 30)))) {
        return `2${String(y - 1911).padStart(2, '0')}${mm}${dd}`;
    }
    return "";
}
// ==========================================
// 📥 資格取得届 e-Gov用 CSV一括出力ロジック（🔥 SaaS完全対応版！）
// ==========================================
document.getElementById('btn-export-shikaku-csv')?.addEventListener('click', async () => {
    if (currentOnboardingUsers.length === 0) {
        alert('現在「承認済」となっている新入社員はいません。');
        return;
    }
    if (!confirm(`承認済の ${currentOnboardingUsers.length} 名分の「資格取得届」を一括出力します。\n出力後、全員のステータスを「提出済」に変更しますか？`))
        return;
    // 🌟 追加①：ログイン中の自分の「会社ID」を取得する！
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId) {
        alert("エラー：会社IDが取得できませんでした。リロードしてお試しください。");
        return;
    }
    // ==========================================
    // 🌟 2. Firebaseから最新の会社情報を取得（データ完全連携！）
    // ==========================================
    let companyMaster = {};
    try {
        // 🌟 修正②：自分の会社IDの箱（companies/会社ID）から取得する！
        const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
        if (docSnap.exists()) {
            companyMaster = docSnap.data();
        }
        else {
            alert("⚠️ 会社情報が設定されていません。\n「法定料率・会社設定」タブから事業所情報を保存してから出力してください。");
            return;
        }
    }
    catch (e) {
        console.error("会社情報の取得エラー:", e);
        alert("会社情報の読み込みに失敗しました。");
        return;
    }
    // e-Gov用メタデータ
    const csvMeta = {
        mediaSeq: "001",
        creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''), // YYYYMMDD
        repCode: "22007" // 🚨 超重要！資格取得届のコード「22007」に修正しました！
    };
    // e-Gov専用：和暦変換エンジン（YYYY-MM-DD -> 令和YYMMDD）
    const getEgoveDate = (dateStr) => {
        if (!dateStr)
            return { gengo: "", date: "" };
        const d = new Date(dateStr);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        if (y >= 2019)
            return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day }; // 令和
        if (y >= 1989)
            return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day }; // 平成
        return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day }; // 昭和
    };
    // ==========================================
    // 🌟 3. 管理レコード（[kanri] ブロック）の生成（最強抽出エンジン）
    // ==========================================
    console.log("🏢 会社マスタの中身:", companyMaster);
    const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
    const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
    const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
    const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
    const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
    const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
    const zipSplit = rawZip.split('-');
    const zip1 = zipSplit[0] || "";
    const zip2 = zipSplit[1] || "";
    const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
    const telSplit = rawTel.split('-');
    const tel1 = telSplit[0] || "";
    const tel2 = telSplit[1] || "";
    const tel3 = telSplit[2] || "";
    const compName = companyMaster.companyName || companyMaster.name || "";
    const repName = companyMaster.employerName || companyMaster.representativeName || "";
    // ヘッダー文字列の組み立て
    let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
    csvContent += "[kanri]\n";
    csvContent += ",001\n";
    csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
    csvContent += "[data]\n";
    // 👇 これ以降の [data] ブロックのループ処理（2200700...など）はそのまま！
    // ローカルマスタの呼び出し（既存ロジック維持）
    const localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
    // ==========================================
    // 🌟 3. データレコード（[data] ブロック：従業員ループ）
    // ==========================================
    currentOnboardingUsers.forEach((emp) => {
        // 既存のデータ名寄せロジック
        const kanji = `${emp.lastNameKanji || ""} ${emp.firstNameKanji || ""}`.trim();
        const kana = `${emp.lastNameKana || ""} ${emp.firstNameKana || ""}`.trim();
        const masterData = localMasterDB[kanji] || {};
        const empid = masterData.empId || emp.employeeId || "";
        const rawBirth = masterData.dob || emp.birthdate || "";
        const rawJoin = emp.contractInfo?.startDate || "";
        const birthEGov = getEgoveDate(rawBirth);
        const joinEGov = getEgoveDate(rawJoin);
        const genderCode = emp.gender === 'male' ? '1' : (emp.gender === 'female' ? '2' : '');
        // 既存の報酬月額の算出ロジック
        const base = Number(emp.baseHealth) || 0;
        const role = Number(emp.allowances?.role) || 0;
        const family = Number(emp.allowances?.family) || 0;
        const housing = Number(emp.allowances?.housing) || 0;
        const fixedOt = Number(emp.allowances?.fixedOt) || 0;
        const commute = Number(emp.allowances?.commute) || 0;
        const totalWage = base + role + family + housing + fixedOt + commute;
        // 🌟 NEW: 扶養家族の有無を自動判定するエンジン
        // ※データベース上で家族情報が 'dependents' や 'family' という配列で保存されていると仮定しています。
        // もし実際のプロパティ名が違う場合は書き換えてください（例: emp.familyMembers など）
        const familyList = emp.dependents || masterData.dependents || emp.family || [];
        const dependentFlag = familyList.length > 0 ? "1" : "0"; // 家族がいれば"1"、いなければ"0"
        // 🌟 NEW: 項番26（備考欄項目３：短時間労働者フラグ）の判定
        let remarksItem3 = ""; // 一般・パートは空欄
        if (emp.socialInsuranceType === 'short_time') {
            remarksItem3 = "1"; // ⏱️ 短時間労働者のみ「1」を立てる！
        }
        // 仕様書完全準拠の34項目配列
        const row = [
            "2200700", // 1. 様式コード（資格取得）
            prefCode, // 2. 都道府県コード（書き換え！）
            cityCode, // 3. 郡市区符号（書き換え！）
            officeSymbol, // 4. 事業所記号（書き換え！）
            officeNumber, // 5. 事業所番号（書き換え！）
            empid, // 6. 被保険者整理番号
            kana, // 7. 氏名カナ
            kanji, // 8. 氏名漢字
            birthEGov.gengo, // 9. 生年月日_元号
            birthEGov.date, // 10. 生年月日_年月日
            genderCode, // 11. 種別 (男子:1, 女子:2)
            "1", // 12. 取得区分 (1:健保・厚年同時)
            emp.myNumber || masterData.myNumber || "", // 13. 個人番号
            "", // 14. 記載できない理由
            "", // 15. 備考欄
            "", // 16. 課所符号
            emp.pensionNumber || masterData.pensionNumber || "", // 17. 基礎年金番号
            joinEGov.gengo, // 18. 取得年月日_元号
            joinEGov.date, // 19. 取得年月日_年月日
            // 🌟 変更: ここをハードコードから動的フラグに変更！
            dependentFlag, // 20. 被扶養者の有無 (1:有, 0:無)
            totalWage.toString(), // 21. 通貨によるものの額
            "0", // 22. 現物によるものの額
            totalWage.toString(), // 23. 合計
            "", // 24. 備考欄項目1（70歳以上該当等）
            "", // 25. 備考欄項目2（二以上事業所勤務等）
            remarksItem3, // 26. 🌟備考欄項目3（短時間労働者フラグ）
            "", // 27. 備考欄項目4（退職後の継続再雇用等）
            "", // 28. 備考欄（その他の理由）
            emp.zip1 || masterData.zip1 || "", // 29. 親番号
            emp.zip2 || masterData.zip2 || "", // 30. 子番号
            emp.addressKana || masterData.addressKana || "", // 31. 住所カナ
            emp.addressKanji || masterData.addressKanji || "", // 32. 住所漢字
            "", // 33. 70歳以上該当
            "1" // 34. 資格確認書発行要否(1:要)
        ];
        csvContent += row.join(",") + "\n";
    });
    // ==========================================
    // 🌟 4. ダウンロード実行
    // ==========================================
    // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（資格取得版）
    const unicodeArray = Encoding.stringToCode(csvContent);
    const sjisArray = Encoding.convert(unicodeArray, {
        to: 'SJIS',
        from: 'UNICODE'
    });
    const uint8Array = new Uint8Array(sjisArray);
    const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", "SHFD0006.CSV");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // ==========================================
    // 🌟 5. ステータス更新
    // ==========================================
    try {
        for (const emp of currentOnboardingUsers) {
            if (emp.email) {
                await updateDoc(doc(db, 'invites', emp.email), { status: '提出済' });
            }
        }
        alert('🎉 出力完了！対象者のステータスを「提出済（役所の公認待ち）」に一括更新しました。');
        loadEmployeeList();
        document.getElementById('review-panel')?.classList.add('hidden');
    }
    catch (e) {
        console.error("ステータス更新エラー", e);
        alert("CSVは出力されましたが、ステータスの更新に失敗しました。");
    }
});
// 承認・差戻しボタン
btnApprove?.addEventListener('click', async () => {
    if (!selectedUserEmail)
        return;
    if (confirm(`${selectedUserEmail} の手続きを「承認（完了）」にしますか？`)) {
        await updateDoc(doc(db, 'invites', selectedUserEmail), { status: '完了' });
        reviewPanel.classList.add('hidden');
        loadEmployeeList();
    }
});
btnReject?.addEventListener('click', async () => {
    if (!selectedUserEmail)
        return;
    if (confirm(`${selectedUserEmail} のデータを「差戻し（再入力要求）」にしますか？`)) {
        await updateDoc(doc(db, 'invites', selectedUserEmail), { status: '入力中' });
        reviewPanel.classList.add('hidden');
        loadEmployeeList();
    }
});
logoutBtn?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = '/';
});
inviteForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = inviteEmailInput.value;
    if (inviteMsg) {
        inviteMsg.style.display = 'block';
        inviteMsg.innerText = '✉️ 送信中...';
    }
    // 🌟 会社IDを取得
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId) {
        alert("エラー：会社IDが取得できませんでした。リロードしてお試しください。");
        return;
    }
    // 🌟🌟🌟 【追加：SaaS防壁】ハイジャック防止の事前チェック！ 🌟🌟🌟
    // 実際にメールを送る前に、データベースに既にこのメアドが存在するか確認する
    const inviteRef = doc(db, 'invites', email);
    const inviteSnap = await getDoc(inviteRef);
    if (inviteSnap.exists()) {
        // 既に存在していたら、エラーを出して処理を強制終了！
        alert("エラー：このメールアドレスは既に他の会社で招待されているか、システムに登録済みです。");
        if (inviteMsg) {
            inviteMsg.style.display = 'none';
        } // 「送信中...」の文字を消す
        return;
    }
    // 🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟
    // 防壁を通過した（まだどこにも登録されていない）場合のみ、メール送信と保存を実行！
    const success = await sendInviteEmail(email);
    if (success) {
        // さっき作った inviteRef を使って保存します
        await setDoc(inviteRef, {
            email: email,
            status: '未登録',
            invitedAt: serverTimestamp(),
            companyId: currentCompanyId
        });
        inviteForm.reset();
        if (inviteMsg) {
            inviteMsg.style.color = '#28a745';
            inviteMsg.innerText = `✓ ${email} 宛に招待メールを送信しました！`;
        }
    }
    else {
        if (inviteMsg) {
            inviteMsg.style.color = '#dc3545';
            inviteMsg.innerText = '送信失敗。';
        }
    }
});
// ==========================================
// 🏢 労務担当入力（会社側データ）の制御ロジック
// ==========================================
window.targetEmployeeId = null; // 💡 確実なグローバル変数（記憶喪失対策の最強版）
// 要素取得
const hrJoinDate = document.getElementById('hr-join-date');
const hrEmpType = document.getElementById('hr-emp-type');
const hrWeeklyHours = document.getElementById('hr-weekly-hours');
const hrMonthlyDays = document.getElementById('hr-monthly-days');
const hrShortContract = document.getElementById('hr-short-contract');
const hrIsStudent = document.getElementById('hr-is-student');
const hrEligibilityResult = document.getElementById('hr-eligibility-result');
// 🌟🌟 NEW: これを追加！ 🌟🌟
const hrSocialInsType = document.getElementById('hr-social-ins-type');
const hrSalaryType = document.getElementById('hr-salary-type');
const hrBaseSalary = document.getElementById('hr-base-salary');
const hrAllowanceRole = document.getElementById('hr-allowance-role');
const hrAllowanceFamily = document.getElementById('hr-allowance-family');
const hrAllowanceHousing = document.getElementById('hr-allowance-housing');
const hrFixedOtHours = document.getElementById('hr-fixed-ot-hours');
const hrAllowanceFixedOt = document.getElementById('hr-allowance-fixed-ot');
const hrAllowanceCommute = document.getElementById('hr-allowance-commute');
const hrTotalWage = document.getElementById('hr-total-wage');
const hrClosingDay = document.getElementById('hr-closing-day');
const hrPaymentMonth = document.getElementById('hr-payment-month');
const hrPaymentDay = document.getElementById('hr-payment-day');
const btnSaveContract = document.getElementById('btn-save-contract');
const hrSaveMsg = document.getElementById('hr-save-msg');
// 💡 1. 自動アシスト機能（雇用形態チェンジ）
// 💡 1. 自動アシスト機能（雇用形態チェンジ）
hrEmpType?.addEventListener('change', () => {
    if (hrEmpType.value === '正社員') {
        hrWeeklyHours.value = '40';
        hrMonthlyDays.value = '30';
        // 🌟 自動で一般（17日基準）にする
        if (hrSocialInsType)
            hrSocialInsType.value = 'regular';
    }
    else if (hrEmpType.value === 'パートタイム・アルバイト') {
        hrWeeklyHours.value = '';
        hrMonthlyDays.value = '';
        // 🌟 パートを選んだら、自動でパート（15日基準）にする
        if (hrSocialInsType)
            hrSocialInsType.value = 'part_time';
    }
    else if (hrEmpType.value === '') {
        hrWeeklyHours.value = '';
        hrMonthlyDays.value = '';
    }
    updateWagesAndEligibility();
});
// 💡 2. 給与計算 ＆ 8.8万円判定 ＆ 社保加入判定の統合エンジン
function updateWagesAndEligibility() {
    const type = hrSalaryType.value;
    const unitBase = Number(hrBaseSalary.value) || 0;
    const weeklyHours = Number(hrWeeklyHours.value) || 0;
    const monthlyDays = Number(hrMonthlyDays.value) || 0;
    let monthlyBase = 0;
    const baseLabel = document.getElementById('hr-base-label');
    const convertedMsg = document.getElementById('hr-monthly-converted');
    if (type === '時給') {
        monthlyBase = Math.round(unitBase * weeklyHours * 52 / 12);
        baseLabel.innerText = '時給（単価）';
        convertedMsg.innerText = `≒ 月額 ${monthlyBase.toLocaleString()}円`;
    }
    else if (type === '日給') {
        monthlyBase = unitBase * monthlyDays;
        baseLabel.innerText = '日給（単価）';
        convertedMsg.innerText = `≒ 月額 ${monthlyBase.toLocaleString()}円`;
    }
    else {
        monthlyBase = unitBase;
        baseLabel.innerText = '基本給（月額）';
        convertedMsg.innerText = '';
    }
    const role = Number(hrAllowanceRole.value) || 0;
    const family = Number(hrAllowanceFamily.value) || 0;
    const housing = Number(hrAllowanceHousing.value) || 0;
    const fixedOt = Number(hrAllowanceFixedOt.value) || 0;
    const commute = Number(hrAllowanceCommute.value) || 0;
    const wageFor88k = monthlyBase + role + family + housing + fixedOt;
    const totalWage = wageFor88k + commute;
    document.getElementById('hr-88k-wage').innerText = wageFor88k.toLocaleString();
    hrTotalWage.innerText = totalWage.toLocaleString();
    const isShort = hrShortContract.checked;
    const isStudent = hrIsStudent.checked;
    if (weeklyHours === 0 && monthlyDays === 0) {
        hrEligibilityResult.innerHTML = "📝 労働時間を入力してください";
        hrEligibilityResult.style.color = "#6c757d";
        return;
    }
    if (isShort || isStudent) {
        hrEligibilityResult.innerHTML = "❌ 加入対象外（短期契約 または 昼間学生）";
        hrEligibilityResult.style.color = "#dc3545";
        return;
    }
    // ==========================================
    // 🌟 ここから下の判定ロジックを少し書き換えます！
    // ==========================================
    let isEligible = false; // 👈 NEW: 加入対象かどうかを判定するフラグを準備！
    // 💡 まず、画面で選ばれている「社保区分」を取得する
    const socialInsType = hrSocialInsType ? hrSocialInsType.value : '';
    if (socialInsType === 'short_time') {
        // ----------------------------------------------------
        // 【ケース1】短時間労働者（11日基準）を選んでいる場合
        // ----------------------------------------------------
        if (weeklyHours >= 20) {
            if (wageFor88k >= 88000) {
                hrEligibilityResult.innerHTML = "✅ 加入義務あり（短時間労働者の要件クリア：週20H以上・月額8.8万以上等）";
                hrEligibilityResult.style.color = "#28a745";
                isEligible = true;
            }
            else {
                hrEligibilityResult.innerHTML = "❌ 加入対象外（週20時間以上だが、月額8.8万円未満）";
                hrEligibilityResult.style.color = "#6c757d";
                isEligible = false;
            }
        }
        else {
            hrEligibilityResult.innerHTML = "❌ 加入対象外（週所定労働時間が20時間未満）";
            hrEligibilityResult.style.color = "#6c757d";
            isEligible = false;
        }
    }
    else {
        // ----------------------------------------------------
        // 【ケース2】一般（17日）または パート（15日）を選んでいる場合（3/4要件）
        // ----------------------------------------------------
        if (weeklyHours >= 30) {
            hrEligibilityResult.innerHTML = "✅ 加入義務あり（3/4要件クリア・週30時間以上）";
            hrEligibilityResult.style.color = "#28a745";
            isEligible = true;
        }
        else {
            // 30時間未満で一般・パートを選んでいる場合は、エラー的なメッセージを出す
            hrEligibilityResult.innerHTML = "⚠️ 加入対象外（3/4要件を満たしていません。区分が『短時間労働者』ではないか確認してください）";
            hrEligibilityResult.style.color = "#fd7e14";
            isEligible = false;
        }
    }
    // 🌟 修正：お給料があって、かつ「加入対象（isEligible が true）」の時だけ計算して表示する！
    if (wageFor88k > 0 && isEligible) {
        const insuranceInfo = calculateSocialInsurance(totalWage);
        console.log(`=== 💰 法定料率マスタ適用結果（${DEFAULT_RATES.prefecture}） ===`);
        console.log(`等級算定ベース額: ${totalWage.toLocaleString()}円`);
        console.log(`健康保険: ${insuranceInfo.healthGrade}等級 (標準報酬 ${insuranceInfo.standardHealth.toLocaleString()}円) -> 引かれモノ: ${insuranceInfo.healthPremium.toLocaleString()}円`);
        console.log(`厚生年金: ${insuranceInfo.pensionGrade}等級 (標準報酬 ${insuranceInfo.standardPension.toLocaleString()}円) -> 引かれモノ: ${insuranceInfo.pensionPremium.toLocaleString()}円`);
        console.log(`===========================================`);
        // 💡 コンソールの出力を、実際の画面（加入判定エリア）にも追記してあげる
        const insuranceHtml = `
      <div style="margin-top: 10px; padding: 12px; background-color: #e9ecef; border-radius: 8px; border-left: 4px solid #0056b3; font-size: 13px; color: #333;">
        <strong style="color: #0056b3;">💡 決定した社会保険（${DEFAULT_RATES.prefecture}料率）</strong><br>
        <span style="display:inline-block; width:60px;">健康保険:</span> ${insuranceInfo.healthGrade}等級（標準報酬: ${insuranceInfo.standardHealth.toLocaleString()}円） ➔ 従業員負担: <strong>${insuranceInfo.healthPremium.toLocaleString()}円</strong><br>
        <span style="display:inline-block; width:60px;">厚生年金:</span> ${insuranceInfo.pensionGrade}等級（標準報酬: ${insuranceInfo.standardPension.toLocaleString()}円） ➔ 従業員負担: <strong>${insuranceInfo.pensionPremium.toLocaleString()}円</strong>
      </div>
    `;
        hrEligibilityResult.innerHTML += insuranceHtml;
    }
}
[
    hrWeeklyHours, hrMonthlyDays, hrShortContract, hrIsStudent,
    hrSalaryType, hrBaseSalary, hrAllowanceRole, hrAllowanceFamily,
    hrAllowanceHousing, hrAllowanceFixedOt, hrAllowanceCommute
].forEach(el => {
    el.addEventListener('input', updateWagesAndEligibility);
    el.addEventListener('change', updateWagesAndEligibility);
});
// 💡 左側のリストがクリックされたら、金額の自動計算も走らせる
document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.closest('.user-item')) {
        setTimeout(updateWagesAndEligibility, 500);
    }
});
// 💡 Firestoreへの保存処理（絶対失敗しないバージョン）
btnSaveContract?.addEventListener('click', async () => {
    // 💡 変数ではなく、ボタン自体に刻まれたメアドを読み取る
    const targetEmail = btnSaveContract.getAttribute('data-target-email');
    if (!targetEmail) {
        return alert("ユーザーが選択されていません。左のリストから再度クリックしてください。");
    }
    // 保存ボタンを押した瞬間に、メアドを元にFirebaseへIDを取りに行く
    // 🌟 1. 会社IDを取得して防壁を張る！
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId) {
        return alert("会社情報が読み込めません。");
    }
    // 🌟 2. 【超重要】「自社の従業員」だけを絞り込んでIDを取りに行く！
    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
    const usersSnapshot = await getDocs(usersQuery);
    let targetId = null;
    usersSnapshot.forEach((uSnap) => {
        const d = uSnap.data();
        // ドキュメントIDがメアドの場合と、中のデータがメアドの場合の両方に対応
        if (uSnap.id === targetEmail || d.email === targetEmail)
            targetId = uSnap.id;
    });
    if (!targetId)
        return alert("データベース上にユーザーのIDが見つかりません。");
    // 💡 ① まず、保存する直前に「画面に表示されている合計金額」を使って、もう一度保険料を計算する
    const finalTotalWage = Number(hrTotalWage.innerText.replace(/,/g, ''));
    let finalInsuranceData = null;
    if (finalTotalWage > 0) {
        // さっき作った最強の計算エンジンを呼び出す
        finalInsuranceData = calculateSocialInsurance(finalTotalWage);
    }
    // 💡 ② Firebaseに保存するデータの塊（contractInfo）の中に、計算結果を丸ごとねじ込む！
    const contractInfo = {
        joinDate: hrJoinDate.value,
        empType: hrEmpType.value,
        workingHours: {
            weeklyHours: Number(hrWeeklyHours.value),
            monthlyDays: Number(hrMonthlyDays.value),
            isShortContract: hrShortContract.checked,
            isStudent: hrIsStudent.checked
        },
        remuneration: {
            salaryType: hrSalaryType.value,
            baseSalary: Number(hrBaseSalary.value),
            allowanceRole: Number(hrAllowanceRole.value),
            allowanceFamily: Number(hrAllowanceFamily.value),
            allowanceHousing: Number(hrAllowanceHousing.value),
            fixedOtHours: Number(hrFixedOtHours.value),
            allowanceFixedOt: Number(hrAllowanceFixedOt.value),
            allowanceCommute: Number(hrAllowanceCommute.value),
            totalEstimatedWage: finalTotalWage
        },
        payrollMaster: {
            closingDay: hrClosingDay.value,
            paymentMonth: hrPaymentMonth.value,
            paymentDay: hrPaymentDay.value
        },
        // 👇 ここを追加！ 計算した保険料と等級のデータをまるごと保存！
        socialInsurance: finalInsuranceData,
        updatedAt: new Date()
    };
    try {
        await setDoc(doc(db, 'users', targetId), { contractInfo }, { merge: true });
        hrSaveMsg.innerText = '✓ 会社側の契約データを保存しました！';
        hrSaveMsg.style.display = 'block';
        setTimeout(() => { hrSaveMsg.style.display = 'none'; }, 3000);
    }
    catch (error) {
        console.error("会社側データ保存エラー:", error);
        alert("保存に失敗しました。");
    }
});
// ==========================================
// 💡 外部HTMLコンポーネント動的読み込みエンジン
// ==========================================
// ① 給与タブのHTMLを別ファイルから読み込む関数
// （manager.ts の中盤あたりにある loadSalaryTab を修正）
async function loadSalaryTab() {
    const container = document.getElementById('tab-salary');
    if (!container)
        return;
    try {
        const response = await fetch('/src/tab-salary.html');
        if (!response.ok)
            throw new Error('給与タブファイルの読み込みに失敗しました');
        const htmlText = await response.text();
        container.innerHTML = htmlText;
        initSubTabEvents(); // サブタブ切り替えを有効化
        initMonthlySalaryUI(); // 月額給与のロジックを起動
        initBonusUI(); // 💡 賞与のロジックもここで一緒に起動する！
        initSalarySlipUI();
    }
    catch (error) {
        console.error('HTMLのコンポーネント読み込みエラー:', error);
    }
}
// 👥 従業員一覧タブのHTMLを別ファイルから読み込む関数
async function loadEmployeeListTab() {
    const container = document.getElementById('tab-employee-list');
    if (!container)
        return;
    try {
        // ステップ1で作ったHTMLを引っ張ってくる
        const response = await fetch('/src/tab-employee-list.html');
        if (!response.ok)
            throw new Error('従業員一覧タブの読み込みに失敗しました');
        const htmlText = await response.text();
        // 受け皿にHTMLを流し込む
        container.innerHTML = htmlText;
        // 流し込みが終わったら、従業員マスタのロジックを起動する！
        initEmployeeMasterUI();
    }
    catch (error) {
        console.error('従業員一覧HTMLの読み込みエラー:', error);
    }
}
// ==========================================
// 🌟 給与タブ共通：在籍中/退職済 ＋ 区分 フィルター制御
// ==========================================
// 🌟 修正：引数に「storageKey」を追加して、タブごとにお化けを切り離す！
export function initSalaryFilterUI(activeId, retiredId, selectId, storageKey, reRenderCallback) {
    const btnActive = document.getElementById(activeId);
    const btnRetired = document.getElementById(retiredId);
    const selectType = document.getElementById(selectId);
    // 🚨 犯人だった「道連れ return」は削除しました！
    const statusFilterKey = `${storageKey}_status`;
    const typeFilterKey = `${storageKey}_type`;
    // =========================================================
    // 💡 ① プルダウン（区分）が見つかったら、単独でイベントをセット！
    // =========================================================
    if (selectType) {
        selectType.value = localStorage.getItem(typeFilterKey) || 'all';
        selectType.addEventListener('change', (e) => {
            const selectedValue = e.target.value;
            localStorage.setItem(typeFilterKey, selectedValue);
            reRenderCallback();
        });
    }
    // =========================================================
    // 💡 ② 在籍・退職ボタンが見つかったら、単独でイベントをセット！
    // =========================================================
    if (btnActive && btnRetired) {
        const updateStyle = (filter) => {
            if (filter === 'retired') {
                btnRetired.style.background = '#0056b3';
                btnRetired.style.color = 'white';
                btnActive.style.background = '#e0e0e0';
                btnActive.style.color = '#555';
            }
            else {
                btnActive.style.background = '#0056b3';
                btnActive.style.color = 'white';
                btnRetired.style.background = '#e0e0e0';
                btnRetired.style.color = '#555';
            }
        };
        updateStyle(localStorage.getItem(statusFilterKey) || 'active');
        btnActive.addEventListener('click', () => {
            localStorage.setItem(statusFilterKey, 'active');
            updateStyle('active');
            reRenderCallback();
        });
        btnRetired.addEventListener('click', () => {
            localStorage.setItem(statusFilterKey, 'retired');
            updateStyle('retired');
            reRenderCallback();
        });
    }
}
// 👶 ライフイベントタブのHTMLを読み込むエンジン
async function loadLifeEventTab() {
    const container = document.getElementById('tab-life-event');
    if (!container)
        return;
    try {
        const response = await fetch('/src/tab-life-event.html');
        if (!response.ok)
            throw new Error('ライフイベント画面の読み込みに失敗しました');
        const htmlText = await response.text();
        container.innerHTML = htmlText;
        // 💡 HTMLが読み込まれたら、ライフイベント用の裏側ロジックを起動する！
        initLifeEventUI();
    }
    catch (error) {
        console.error('HTMLのコンポーネント読み込みエラー:', error);
    }
}
// 👶 ライフイベントタブがクリックされた時の処理
const lifeEventTabBtn = document.querySelector('[data-tab="tab-life-event"]');
if (lifeEventTabBtn) {
    lifeEventTabBtn.addEventListener('click', () => {
        const container = document.getElementById('tab-life-event');
        if (container) {
            fetch('/src/tab-life-event.html')
                .then(response => response.text())
                .then(htmlText => {
                container.innerHTML = htmlText;
                if (typeof initLifeEventUI === 'function') {
                    initLifeEventUI();
                }
            })
                .catch(err => console.error('読込エラー:', err));
        }
    });
}
//export async function initLifeEventUI() {がもともとここにあった。。。
// ==========================================
// ✅ タスク管理タブの描画・操作エンジン（e-Gov完全対応版）
// ==========================================
function initTaskUI() {
    // 🌟 1. 会社IDを取得！
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId)
        return;
    // 🌟 2. 会社別のキー名を作る！
    const taskKey = `hr_tasks_${currentCompanyId}`;
    const empMasterKey = `hr_employee_master_${currentCompanyId}`;
    // 🌟 3. 会社専用の箱から読み込む！
    let tasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
    let currentFilter = 'all';
    let currentSort = 'deadline';
    // 🌟 本物の従業員マスターデータも会社専用の箱から読み込む！
    const employeeMasterDB = JSON.parse(localStorage.getItem(empMasterKey) || '{}');
    // 💡 魔法②：e-Gov用 和暦変換エンジン（西暦を「令和X年X月X日」に変換）
    const toJapaneseEra = (dateString) => {
        if (!dateString)
            return '';
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { era: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
    };
    const renderTasks = () => {
        const today = new Date();
        // 🌟 右上のアラートウィジェット
        const urgentWidgetList = document.getElementById('urgent-list');
        const urgentCount = document.getElementById('urgent-count');
        const urgentWidgetBox = document.getElementById('urgent-tasks-widget');
        if (urgentWidgetList && urgentCount && urgentWidgetBox) {
            let urgentTasks = tasks.filter((t) => {
                if (t.status === 'done' || t.status === 'archive')
                    return false;
                const diffDays = Math.ceil((new Date(t.deadline).getTime() - today.getTime()) / (1000 * 3600 * 24));
                return diffDays <= 3;
            });
            urgentTasks.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
            urgentCount.innerText = `${urgentTasks.length}件`;
            if (urgentTasks.length === 0) {
                urgentWidgetBox.style.borderColor = '#28a745';
                urgentWidgetBox.style.boxShadow = 'none';
                urgentCount.style.background = '#28a745';
                urgentWidgetList.innerHTML = `<div style="font-size: 12px; color: #28a745; text-align: center; padding: 10px 0;">✅ 期限が迫っているタスクはありません</div>`;
            }
            else {
                urgentWidgetBox.style.borderColor = '#dc3545';
                urgentWidgetBox.style.boxShadow = '0 4px 10px rgba(220,53,69,0.15)';
                urgentCount.style.background = '#dc3545';
                const displayTasks = urgentTasks.slice(0, 5);
                let html = displayTasks.map((t) => {
                    const diffDays = Math.ceil((new Date(t.deadline).getTime() - today.getTime()) / (1000 * 3600 * 24));
                    const badge = diffDays < 0 ? `<span style="color:#dc3545; font-weight:bold;">⚠️ ${Math.abs(diffDays)}日超過</span>` : `<span style="color:#d39e00; font-weight:bold;">⏳ あと${diffDays}日</span>`;
                    const barColor = diffDays < 0 ? '#dc3545' : '#ffc107';
                    return `<div style="font-size: 11px; background: #f8f9fa; border: 1px solid #eee; padding: 8px; border-radius: 4px; border-left: 3px solid ${barColor};">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">${badge} <span style="color:#666;">${t.empName}</span></div>
            <div style="font-weight:bold; color:#0056b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.title}</div>
          </div>`;
                }).join('');
                if (urgentTasks.length > 5)
                    html += `<div style="text-align: center; font-size: 11px; color: #666; margin-top: 5px; font-weight: bold;">＋ 他 ${urgentTasks.length - 5} 件のタスク</div>`;
                urgentWidgetList.innerHTML = html;
            }
        }
        // 🌟 カンバン本体の更新
        ['todo', 'doing', 'done'].forEach(status => {
            const list = document.getElementById(`list-${status}`);
            const count = document.getElementById(`count-${status}`);
            if (!list || !count)
                return;
            let filtered = tasks.filter((t) => t.status === status && (currentFilter === 'all' || t.agency === currentFilter));
            filtered.sort((a, b) => {
                if (currentSort === 'deadline')
                    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
                else
                    return b.id - a.id;
            });
            count.innerText = filtered.length.toString();
            list.innerHTML = '';
            filtered.forEach((task) => {
                const card = document.createElement('div');
                const borderColor = status === 'todo' ? '#dc3545' : status === 'doing' ? '#ffc107' : '#28a745';
                card.style.cssText = `background: #fff; padding: 15px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border-left: 5px solid ${borderColor}; transition: 0.3s;`;
                const diffDays = Math.ceil((new Date(task.deadline).getTime() - today.getTime()) / (1000 * 3600 * 24));
                let dlBadge = '';
                if (status !== 'done') {
                    if (diffDays < 0)
                        dlBadge = `<span style="background:#dc3545; color:#fff; padding:2px 6px; border-radius:4px; font-size:10px;">⚠️ ${Math.abs(diffDays)}日超過</span>`;
                    else if (diffDays <= 3)
                        dlBadge = `<span style="background:#ffc107; color:#333; padding:2px 6px; border-radius:4px; font-size:10px;">⏳ あと${diffDays}日</span>`;
                    else
                        dlBadge = `<span style="background:#e9ecef; color:#666; padding:2px 6px; border-radius:4px; font-size:10px;">📅 あと${diffDays}日</span>`;
                }
                else {
                    dlBadge = `<span style="background:#d4edda; color:#155724; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold;">✅ 処理済み</span>`;
                }
                // 🌟 変更後：コンパクトで可愛い「バッジ」に変更！
                const memoDisplay = task.memo ? `<div class="open-memo-btn" style="margin-top: 8px; display: inline-block; font-size: 11px; background: #fff3cd; color: #856404; padding: 4px 12px; border-radius: 12px; border: 1px solid #ffeeba; cursor: pointer; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" title="クリックしてメモを読む">📝 メモあり</div>` : '';
                // 🌟🌟🌟 NEW: 月変タスク専用のCSVボタンを用意する 🌟🌟🌟
                let csvBtnHtml = '';
                if (task.title && task.title.includes('月額変更届') && task.targetYear && task.targetMonth) {
                    csvBtnHtml = `<button class="btn-export-geppen-task" data-year="${task.targetYear}" data-month="${task.targetMonth}" style="margin-left: 8px; padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">📄 e-Gov用CSV</button>`;
                }
                // 期限表示ロジック（ここを整理しました）
                const deadlineDate = new Date(task.deadline);
                const diff = Math.ceil((deadlineDate.getTime() - new Date().getTime()) / (1000 * 3600 * 24));
                let deadlineHtml = '';
                if (isNaN(deadlineDate.getTime())) {
                    deadlineHtml = `<span style="font-size: 9px; background: #e9ecef; padding: 2px 6px; border-radius: 4px; color: #666;">期限未設定</span>`;
                }
                else if (diff < 0) {
                    deadlineHtml = `<span style="font-size: 9px; background: #dc3545; color: white; padding: 2px 6px; border-radius: 4px;">超過 ${Math.abs(diff)}日</span>`;
                }
                else if (diff === 0) {
                    deadlineHtml = `<span style="font-size: 9px; background: #fd7e14; color: white; padding: 2px 6px; border-radius: 4px;">今日が期限</span>`;
                }
                else {
                    deadlineHtml = `<span style="font-size: 9px; background: #28a745; color: white; padding: 2px 6px; border-radius: 4px;">あと${diff}日</span>`;
                }
                card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <input type="checkbox" class="task-select-cb" data-id="${task.id}" style="cursor: pointer;">
          <div style="display: flex; gap: 6px; align-items: center;">
            <span style="font-size: 9px; background: #f8f9fa; border: 1px solid #ccc; padding: 2px 6px; border-radius: 4px; color: #555;">${task.agency || '不明'}</span>
          ${dlBadge}
          </div>
        </div>
  
        <div style="font-weight: bold; color: #0056b3; margin-bottom: 6px; font-size: 13px;">${task.title}</div>
        
        <div style="font-size: 12px; color: #666; margin-bottom: 10px;">
          対象: <b>${task.empName}</b> <br> 
          <span style="font-size: 10px;">発生元: ${task.source}</span>
        </div>

        <p style="color: #d9534f; font-weight: bold; font-size: 0.85em; margin-top: 5px;">
       期限：${task.deadline}
       </p>
  
        ${memoDisplay}
  
        <div style="display:flex; justify-content: flex-end; margin-bottom: 8px;">
          ${csvBtnHtml} 
        </div>
  
        <div style="display: flex; gap: 8px; border-top: 1px dashed #ccc; padding-top: 8px;">
          <button class="btn-notify" data-empname="${task.empName}" data-tasktitle="${task.title}" 
                  style="background: #fff; color: #b08d00; border: 1px solid #ffc107; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; flex: 1;">
            📣 通知
          </button>
        </div>
      `;
                const exportBtn = card.querySelector('.btn-export-geppen-task');
                if (exportBtn) {
                    exportBtn.addEventListener('click', (e) => {
                        e.stopPropagation(); // カード自体のクリック判定を邪魔しないための魔法
                        // ボタンに埋め込んだ「年月」のデータを取り出す
                        const y = Number(exportBtn.getAttribute('data-year'));
                        const m = Number(exportBtn.getAttribute('data-month'));
                        // 一番下に作った最強のCSV出力エンジンを呼び出す！
                        if (typeof downloadGeppenCSV === 'function') {
                            downloadGeppenCSV(y, m);
                        }
                        else {
                            window.downloadGeppenCSV(y, m);
                        }
                    });
                }
                // 🌟 モーダルを開く処理を共通の機能としてまとめる
                const openMemoModal = () => {
                    const modal = document.getElementById('memo-modal');
                    const titleEl = document.getElementById('memo-task-title');
                    const textarea = document.getElementById('memo-textarea');
                    const idInput = document.getElementById('memo-task-id');
                    if (modal && titleEl && textarea && idInput) {
                        titleEl.innerText = `${task.empName} - ${task.title}`;
                        textarea.value = task.memo || '';
                        idInput.value = task.id;
                        modal.style.display = 'flex';
                    }
                };
                // ① これまで通り、カードのどこかをダブルクリックしても開く（新規追加や編集用）
                card.addEventListener('dblclick', openMemoModal);
                // ② 【追加】「📝 メモあり」バッジを1回クリックしただけでも開くようにする！
                const memoBadge = card.querySelector('.open-memo-btn');
                if (memoBadge) {
                    memoBadge.addEventListener('click', (e) => {
                        e.stopPropagation(); // カード全体のクリックと干渉しないようにする安全対策
                        openMemoModal();
                    });
                }
                // =========================================================
                list.appendChild(card);
            });
        });
        // ==========================================
        // 🌟 究極の一括処理 ＆ 複数人同時の自動免除エンジン
        // ==========================================
        const executeBulkMove = async (toStatus, event) => {
            const target = event.currentTarget;
            // 🌟🌟🌟 追加 1：最初にボタンの元の名前（「一括進行中へ ➡️」など）を記憶しておく！
            const originalText = target.innerText;
            const checkedBoxes = document.querySelectorAll('.task-select-cb:checked');
            if (checkedBoxes.length === 0) {
                alert('タスクが選択されていません。左上のチェックボックスを入れてください。');
                return;
            }
            // 🟢 修正後のコード（すべてStringの文字列として比較する！）
            const idsToMove = Array.from(checkedBoxes).map(cb => String(cb.getAttribute('data-id')));
            const tasksToMove = tasks.filter((t) => idsToMove.includes(String(t.id)));
            // 👇👇👇 🌟🌟🌟 ここからX線診断コードを挿入！ 🌟🌟🌟 👇👇👇
            console.log("🕵️‍♂️==== エンジン内部診断スタート ====");
            console.log("① 受け取った移動先 (toStatus):", toStatus);
            console.log("② 取得したタスク:", tasksToMove);
            if (tasksToMove.length > 0) {
                const t = tasksToMove[0];
                console.log(`③ タスクの状態 -> タイトル: ${t.title}, 現在のstatus: ${t.status}`);
                // 戻す時の判定（免除OFF）がどうなっているかチェック
                const isRevertingExemption = (t.status === 'done' && toStatus !== 'done' && t.title.includes('育児休業等取得者申出書'));
                console.log(`④ 免除OFF判定 -> クリアしてる？: ${isRevertingExemption}`);
            }
            console.log("🕵️‍♂️===============================");
            // 👆👆👆 🌟🌟🌟 ここまで 🌟🌟🌟 👆👆👆
            let shouldMove = true;
            // 1️⃣ 🌟 社会保険料を「免除（0円）」に設定したい対象 (ONにする)
            const turnOnTasks = tasksToMove.filter((t) => {
                // 🌟 異物混入を防ぐ最強の文字列サニタイズ（見えないスペースを破壊！）
                const safeStatus = String(t.status || '').trim();
                const safeTitle = String(t.title || '');
                // 🌟 タイトルは「育児休業等」だけで部分一致させる（全角半角のブレを完全回避）
                const isCompletingExemption = (toStatus === 'done' && safeStatus !== 'done' && safeTitle.includes('育児休業等'));
                const isRevertingReinstatement = (safeStatus === 'done' && toStatus !== 'done' && safeTitle.includes('控除再開'));
                return isCompletingExemption || isRevertingReinstatement;
            });
            // 2️⃣ 🌟 社会保険料の免除を解除し、「通常徴収」に戻したい対象 (OFFにする)
            const turnOffTasks = tasksToMove.filter((t) => {
                const safeStatus = String(t.status || '').trim();
                const safeTitle = String(t.title || '');
                const isCompletingReinstatement = (toStatus === 'done' && safeStatus !== 'done' && safeTitle.includes('控除再開'));
                const isRevertingExemption = (safeStatus === 'done' && toStatus !== 'done' && safeTitle.includes('育児休業等'));
                return isCompletingReinstatement || isRevertingExemption;
            });
            // 🟢 免除ON（0円）の処理
            if (turnOnTasks.length > 0) {
                const names = turnOnTasks.map((t) => t.empName).join('、');
                if (confirm(`【⚠️ 免除設定の確認】\n${names} さんの設定を変更します。\n社会保険料を「免除（0円）」に設定してよろしいですか？`)) {
                    try {
                        if (target) {
                            target.innerText = '処理中...';
                            target.disabled = true;
                        }
                        // 🌟 【防壁】自社の従業員だけで絞り込む！
                        const currentCompanyId = localStorage.getItem('current_company_id');
                        if (!currentCompanyId)
                            throw new Error("会社IDがありません");
                        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                        const usersSnap = await getDocs(usersQuery);
                        for (const task of turnOnTasks) {
                            let targetDocId = null;
                            usersSnap.forEach((u) => {
                                const data = u.data();
                                const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                                // 🌟 最強の照合ロジック：ID優先 ＋ 名前バックアップ
                                const isMatchById = (task.employeeId && data.employeeId === task.employeeId) ||
                                    (task.userId && u.id === task.userId) ||
                                    (task.empId && data.employeeId === task.empId);
                                const isMatchByName = (fullName === task.empName || data.employeeId === task.empName);
                                if (isMatchById || isMatchByName) {
                                    targetDocId = u.id;
                                }
                            });
                            if (targetDocId)
                                await updateDoc(doc(db, 'users', targetDocId), { isSocialInsuranceExempt: true });
                        }
                    }
                    catch (e) {
                        alert('エラーが発生しました');
                        shouldMove = false;
                    }
                }
                else {
                    shouldMove = false;
                }
            }
            // 🔴 免除OFF（徴収再開）の処理
            if (shouldMove && turnOffTasks.length > 0) {
                const names = turnOffTasks.map((t) => t.empName).join('、');
                // 🌟 ここから変更：親切でわかりやすい警告文を作成
                const confirmMsg = `【🔄 控除再開（免除の解除）の確認】\n` +
                    `${names} さんの社会保険料を「通常徴収」に戻しますか？\n\n` +
                    `⚠️ 注意 ⚠️\n` +
                    `この操作を行うと、システム上ですぐに保険料の徴収設定が再開されます。\n` +
                    `（例：6月支給の給与から天引きを再開したい場合は、6月の給与計算を行うタイミングでこのタスクを完了にしてください）\n\n` +
                    `今すぐ設定を変更してもよろしいですか？`;
                if (confirm(confirmMsg)) {
                    try {
                        if (target) {
                            target.innerText = '処理中...';
                            target.disabled = true;
                        }
                        // 🌟 【防壁】危険なバックドア（全社取得）を完全に塞ぐ！
                        const currentCompanyId = localStorage.getItem('current_company_id');
                        if (!currentCompanyId)
                            throw new Error("会社IDがありません");
                        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                        const usersSnap = await getDocs(usersQuery);
                        for (const task of turnOffTasks) {
                            let targetDocId = null;
                            usersSnap.forEach((u) => {
                                const data = u.data();
                                const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                                // 🌟 最強の照合ロジック：ID優先 ＋ 名前バックアップ
                                const isMatchById = (task.employeeId && data.employeeId === task.employeeId) ||
                                    (task.userId && u.id === task.userId) ||
                                    (task.empId && data.employeeId === task.empId);
                                const isMatchByName = (fullName === task.empName || data.employeeId === task.empName);
                                if (isMatchById || isMatchByName) {
                                    targetDocId = u.id;
                                }
                            });
                            if (targetDocId)
                                await updateDoc(doc(db, 'users', targetDocId), { isSocialInsuranceExempt: false });
                        }
                    }
                    catch (e) {
                        alert('エラーが発生しました');
                        shouldMove = false;
                    }
                }
                else {
                    shouldMove = false;
                }
            }
            // ==========================================
            // 🟡 パターンC：扶養家族を外す（論理削除）処理（完全防弾版！）
            // ==========================================
            const removeDependentTasks = tasksToMove.filter((t) => {
                const safeStatus = String(t.status || '').trim();
                const safeTitle = String(t.title || '');
                // 🌟 防弾1：カッコの全角半角ブレを無視！「被扶養者」と「減少」の両方が含まれていればヨシとする
                return toStatus === 'done' && safeStatus !== 'done' && safeTitle.includes('被扶養者') && safeTitle.includes('減少');
            });
            if (shouldMove && removeDependentTasks.length > 0) {
                const names = removeDependentTasks.map((t) => t.empName).join('、');
                if (confirm(`【👨‍👩‍👧‍👦 扶養喪失手続きの確認】\n${names} さんの家族を扶養から外す処理（システム上の非表示化）を実行しますか？`)) {
                    try {
                        if (target) {
                            target.innerText = '処理中...';
                            target.disabled = true;
                        }
                        const currentCompanyId = localStorage.getItem('current_company_id');
                        if (!currentCompanyId)
                            throw new Error("会社IDがありません");
                        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                        const usersSnap = await getDocs(usersQuery);
                        for (const task of removeDependentTasks) {
                            let targetDocId = null;
                            usersSnap.forEach((u) => {
                                const data = u.data();
                                const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                                const isMatchById = (task.employeeId && data.employeeId === task.employeeId) ||
                                    (task.userId && u.id === task.userId) ||
                                    (task.empId && data.employeeId === task.empId);
                                const isMatchByName = (fullName === task.empName || data.employeeId === task.empName);
                                if (isMatchById || isMatchByName) {
                                    targetDocId = u.id;
                                }
                            });
                            if (targetDocId) {
                                const userRef = doc(db, 'users', targetDocId);
                                const userDocSnap = await getDoc(userRef);
                                const userData = userDocSnap.data();
                                if (userData && userData.dependents && Array.isArray(userData.dependents)) {
                                    // 🌟 防弾2：タスク側の「対象者名」からすべてのスペースを強制消去！
                                    const rawTargetName = task.targetFamilyName || (task.originalData && task.originalData.targetFamilyName) || task.memo || '';
                                    const cleanTargetName = String(rawTargetName).replace(/[\s ]+/g, ''); // 半角・全角スペースを撲滅
                                    const updatedDependents = userData.dependents.map((dep) => {
                                        // 🌟 防弾3：DB側の「家族名」からもすべてのスペースを強制消去！
                                        const cleanDepName = `${dep.lastNameKanji || ''}${dep.firstNameKanji || ''}`.replace(/[\s ]+/g, '');
                                        // スペース無しの純粋な文字だけで比較！一致したら論理削除フラグを立てる！
                                        if (cleanTargetName && cleanDepName && cleanTargetName.includes(cleanDepName)) {
                                            return {
                                                ...dep,
                                                isRemoved: true,
                                                removedDate: new Date().toISOString()
                                            };
                                        }
                                        return dep;
                                    });
                                    // データベースを更新！
                                    await updateDoc(userRef, { dependents: updatedDependents });
                                    console.log("✅ 家族の論理削除（isRemoved: true）を完了しました！");
                                }
                            }
                        }
                    }
                    catch (e) {
                        alert('エラーが発生しました');
                        console.error(e);
                        shouldMove = false;
                    }
                }
                else {
                    shouldMove = false;
                }
            }
            // ==========================================
            // 🟣 パターンD：退職処理（従業員マスタを退職済みに移動）
            // ==========================================
            const retirementTasks = tasksToMove.filter((t) => {
                const safeStatus = String(t.status || '').trim();
                const safeTitle = String(t.title || '');
                // 🌟 カッコなどのブレを防ぐため、「資格喪失」という最強キーワードだけで検知！
                return toStatus === 'done' && safeStatus !== 'done' && safeTitle.includes('資格喪失');
            });
            if (shouldMove && retirementTasks.length > 0) {
                const names = retirementTasks.map((t) => t.empName).join('、');
                // 🌟 実行前に確認ダイアログを出すことで、労務の誤操作を防止！
                if (confirm(`【🚪 退職処理の自動連携】\n${names} さんの資格喪失手続きが完了しました。\n従業員マスタを「退職済」タブに自動移動させますか？`)) {
                    try {
                        if (target) {
                            target.innerText = '処理中...';
                            target.disabled = true;
                        }
                        const currentCompanyId = localStorage.getItem('current_company_id');
                        if (!currentCompanyId)
                            throw new Error("会社IDがありません");
                        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                        const usersSnap = await getDocs(usersQuery);
                        for (const task of retirementTasks) {
                            let targetDocId = null;
                            usersSnap.forEach((u) => {
                                const data = u.data();
                                const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                                // 🌟 防弾仕様：スペースを完全に除去して純粋な文字だけで比較！
                                const cleanFullName = fullName.replace(/[\s ]+/g, '');
                                const cleanTaskName = String(task.empName || '').replace(/[\s ]+/g, '');
                                const isMatchById = (task.employeeId && data.employeeId === task.employeeId) ||
                                    (task.userId && u.id === task.userId) ||
                                    (task.empId && data.employeeId === task.empId);
                                const isMatchByName = (cleanFullName === cleanTaskName || data.employeeId === task.empName);
                                if (isMatchById || isMatchByName) {
                                    targetDocId = u.id;
                                }
                            });
                            // 🌟 対象者が見つかったら「退職済（retired）」に書き換える！
                            if (targetDocId) {
                                await updateDoc(doc(db, 'users', targetDocId), {
                                    employeeStatus: 'retired',
                                    resignationDate: task.deadline || new Date().toISOString().split('T')[0]
                                });
                                console.log(`✅ ${task.empName} さんを「退職済」に自動更新しました！`);
                            }
                        }
                        // 更新完了のアラート
                        setTimeout(() => {
                            alert(`🚪 従業員マスタを「退職済」に更新しました！`);
                        }, 300);
                    }
                    catch (e) {
                        alert('退職処理中にエラーが発生しました');
                        console.error(e);
                        shouldMove = false;
                    }
                }
                else {
                    // キャンセルした場合はタスクの移動自体を取りやめる
                    shouldMove = false;
                }
            }
            // 🌟🌟🌟 追加 2：免除判定が終わった後、絶対にボタンを元の状態に復活させる！
            if (target) {
                target.innerText = originalText;
                target.disabled = false;
            }
            // 最後の移動処理
            if (shouldMove) {
                // 🌟 修正3：保存先をSaaS化（名前衝突を避けるため、別名「finalTaskKey」を使用！）
                const finalCompanyId = localStorage.getItem('current_company_id');
                const finalTaskKey = finalCompanyId ? `hr_tasks_${finalCompanyId}` : 'hr_tasks';
                tasks = tasks.map((t) => idsToMove.includes(String(t.id)) ? { ...t, status: toStatus } : t);
                // 🌟 ここを専用キーに変更！
                localStorage.setItem(finalTaskKey, JSON.stringify(tasks));
                if (toStatus === 'done') {
                    tasks.forEach((t) => {
                        if (idsToMove.includes(String(t.id))) {
                            checkAndProcessRetirementTask(t);
                        }
                    });
                }
                renderTasks();
            }
            else {
                renderTasks();
            }
        };
        // ==========================================
        // 🌟 最強の配線：「戻す」ボタンの文字検知対応版！
        // ==========================================
        window.globalBulkEngine = executeBulkMove;
        if (!window.isBulkEngineWired) {
            document.addEventListener('click', (e) => {
                const target = e.target;
                const btn = target.closest('button, a, .btn, [class*="btn"]');
                if (!btn)
                    return;
                const text = btn.innerText || "";
                const fakeEvent = { currentTarget: btn };
                if (text.includes('完了')) {
                    e.preventDefault();
                    console.log("🚀 完了エンジン点火！！", text);
                    window.globalBulkEngine('done', fakeEvent);
                }
                // 🎯 修正ポイント：ボタンの文字が「進行中」または「戻す」だったら作動する！
                else if (text.includes('進行中') || text.includes('戻す')) {
                    e.preventDefault();
                    console.log("🚀 進行中（戻す）エンジン点火！！", text);
                    window.globalBulkEngine('doing', fakeEvent);
                }
            }, true);
            window.isBulkEngineWired = true;
        }
        // ==========================================
        // 👇 🌟 ここから下のブロックを追加！ 👇
        document.querySelectorAll('.btn-notify').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetBtn = e.currentTarget;
                const empName = targetBtn.getAttribute('data-empname');
                const taskTitle = targetBtn.getAttribute('data-tasktitle');
                if (!empName) {
                    alert('対象者が設定されていないタスクです。');
                    return;
                }
                // 👇 🌟 この1行を追加！！（TSを安心させる魔法のコード）
                if (!empName || !taskTitle)
                    return;
                // 👇 🌟 ここから差し替え！（元々の confirm を window.prompt に変更します）
                // 自由記述メッセージの入力ダイアログを出す
                const customMessage = window.prompt(`${empName} さんへ送る通知メッセージを入力してください：\n（※キャンセルを押すと送信されません）`, generateNotificationMessage(taskTitle, empName) // 👈 これがデフォルトの定型文として最初から入力されます！
                );
                // キャンセルが押された、または空欄の場合はストップ
                if (!customMessage)
                    return;
                try {
                    targetBtn.innerText = '⌛ 送信中...';
                    targetBtn.disabled = true;
                    // 🌟 変更後：入力された customMessage をそのまま保存します！
                    await addDoc(collection(db, 'notifications'), {
                        targetEmpName: empName,
                        title: taskTitle,
                        message: customMessage, // 👈 🌟 ここが最大のポイント！
                        isRead: false,
                        createdAt: serverTimestamp()
                    });
                    // 👆 🌟 差し替えここまで！
                    // 送信成功UI
                    targetBtn.innerText = '✅ 送信済み';
                    targetBtn.style.background = '#e9ecef';
                    targetBtn.style.color = '#6c757d';
                    targetBtn.style.borderColor = '#ccc';
                    alert('従業員ダッシュボードへ通知を送信しました！');
                }
                catch (error) {
                    console.error("通知の送信エラー:", error);
                    alert('送信に失敗しました。');
                    targetBtn.innerText = '📣 従業員へ通知';
                    targetBtn.disabled = false;
                }
            });
        });
    };
    // 🌟 メモモーダルの制御
    const memoModal = document.getElementById('memo-modal');
    const btnCloseMemo = document.getElementById('btn-close-memo');
    const btnSaveMemo = document.getElementById('btn-save-memo');
    if (btnCloseMemo && memoModal) {
        btnCloseMemo.addEventListener('click', () => memoModal.style.display = 'none');
    }
    if (btnSaveMemo && memoModal) {
        btnSaveMemo.addEventListener('click', () => {
            const textarea = document.getElementById('memo-textarea');
            const idInput = document.getElementById('memo-task-id');
            const taskId = Number(idInput.value);
            const newMemo = textarea.value.trim();
            // 🌟 会社IDと専用キーを取得！
            const currentCompanyId = localStorage.getItem('current_company_id');
            const taskKey = currentCompanyId ? `hr_tasks_${currentCompanyId}` : 'hr_tasks';
            // ローカルストレージのタスクを更新（専用キーで読み込み！）
            let tasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
            const taskIndex = tasks.findIndex((t) => t.id === taskId);
            if (taskIndex > -1) {
                tasks[taskIndex].memo = newMemo; // メモを上書き！
                localStorage.setItem(taskKey, JSON.stringify(tasks)); // 🌟 専用キーで保存！
                memoModal.style.display = 'none';
                // 🌟 画面をリロードせずに、タスクを再描画してメモを即座に表示させる！
                // ※ もし renderTasks() がスコープ外で呼べない場合は、 location.reload(); にしてもOKです。
                location.reload();
            }
        });
    }
    // ==========================================
    // タスク管理一括通知
    // ==========================================
    // ==========================================
    // タスク管理一括通知 (安全バリデーション＆手入力機能つき)
    // ==========================================
    const btnBulkNotify = document.getElementById('btn-bulk-notify');
    if (btnBulkNotify) {
        // 💡 addEventListener ではなく onclick にして、処理の増殖を防止！
        btnBulkNotify.onclick = async () => {
            // 1. 画面上でチェックがついているチェックボックスを全て取得
            const checkedBoxes = document.querySelectorAll('.task-select-cb:checked');
            if (checkedBoxes.length === 0) {
                alert('通知を送りたいタスクにチェックを入れてください。');
                return;
            }
            // 🌟 会社IDを取得して専用キーを作成
            const currentCompanyId = localStorage.getItem('current_company_id');
            const taskKey = currentCompanyId ? `hr_tasks_${currentCompanyId}` : 'hr_tasks';
            // 2. ローカルストレージから全タスクデータを取得（専用キーで読み込み！）
            const tasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
            // 3. 選択されたタスクのデータをすべて抽出
            const selectedTasks = Array.from(checkedBoxes).map(cb => {
                const taskId = Number(cb.getAttribute('data-id'));
                return tasks.find((t) => t.id === taskId);
            }).filter(t => t !== undefined);
            // 🌟🌟 4. 【超重要】タスクの種類がすべて同じかチェック！ 🌟🌟
            const firstTaskTitle = selectedTasks[0].title;
            // 「全てのタスクのタイトルが、1つ目のタスクのタイトルと同じか」を判定
            const isAllSameType = selectedTasks.every(t => t.title === firstTaskTitle);
            if (!isAllSameType) {
                alert('⚠️ エラー：異なる種類のタスクが混ざっています！\n誤送信を防ぐため、一括通知は「同じ種類のタスク」のみで行ってください。');
                return; // 違う種類が混ざっていたらここで強制ストップ！
            }
            // 🌟🌟 5. 送信メッセージを手入力させる 🌟🌟
            const customMessage = prompt(`【${firstTaskTitle}】\nに関する通知を ${checkedBoxes.length} 名に一括送信します。\n送信するメッセージ（理由や案内）を入力してください：\n\n（※キャンセルを押すと送信しません）`, `手続きのご案内です。内容を確認し、対応をお願いいたします。` // デフォルトの文章
            );
            // キャンセルを押したか、空欄の場合は中断
            if (customMessage === null)
                return;
            if (customMessage.trim() === '') {
                alert('⚠️ メッセージを入力してください。');
                return;
            }
            try {
                btnBulkNotify.innerText = '⏳ 送信中...';
                btnBulkNotify.disabled = true;
                let successCount = 0;
                // 6. Firestoreに手打ちメッセージを投函！
                for (const targetTask of selectedTasks) {
                    if (targetTask && targetTask.empName) {
                        await addDoc(collection(db, 'notifications'), {
                            targetEmpName: targetTask.empName,
                            title: targetTask.title, // 通知の「タイトル」としてタスク名をセット
                            message: customMessage, // 📝 従業員が読む本文に「手入力した文字」をセット！
                            isRead: false,
                            createdAt: serverTimestamp()
                        });
                        successCount++;
                    }
                }
                // 7. 成功メッセージ
                alert(`✅ ${successCount} 件の通知を送信しました！`);
                // （任意）送信後にチェックボックスを外す親切設計
                checkedBoxes.forEach(cb => cb.checked = false);
            }
            catch (error) {
                console.error("一括通知エラー:", error);
                alert("送信処理中にエラーが発生しました。");
            }
            finally {
                // ボタンを元の状態に戻す
                btnBulkNotify.innerText = '📣 選択した対象者へ通知';
                btnBulkNotify.disabled = false;
            }
        };
    }
    // =========================================================
    // 🌟🌟🌟 修正版：「全選択 / 解除」のチェックボックス連動ロジック 🌟🌟🌟
    // =========================================================
    window.toggleAllTasks = function (checkbox) {
        const status = checkbox.getAttribute('data-target'); // todo, doing, done
        const isChecked = checkbox.checked;
        // 💡 コンソールに状況を報告させる（F12で確認できます）
        console.log(`[全選択実行] 対象レーン: ${status}, チェック状態: ${isChecked}`);
        // 対象のレーン（list-todoなど）を探す
        const list = document.getElementById(`list-${status}`);
        if (list) {
            // そのレーンの中にあるタスクのチェックボックスを根こそぎ拾う
            const taskCbs = list.querySelectorAll('.task-select-cb');
            console.log(`[全選択] 変更対象のタスク数: ${taskCbs.length}件`);
            // 全部のチェック状態を、親玉（全選択ボックス）と同じにする！
            taskCbs.forEach(cb => {
                cb.checked = isChecked;
            });
        }
        else {
            console.error(`[エラー] 対象のリスト (list-${status}) が見つかりません`);
        }
    };
    // ==========================================
    // 🚀 e-Govフォーマット分岐 CSVエクスポート
    // ==========================================
    // 🌟🌟🌟 ゴースト完全破壊 ＆ 最強インターセプト統合版 🌟🌟🌟
    const oldExportBtn = document.getElementById('btn-export-csv');
    if (oldExportBtn) {
        // 💡 必殺技：ボタンを複製してすり替えることで、過去の古いイベントリスナーをすべて「物理的に破壊」します！
        const exportCsvBtn = oldExportBtn.cloneNode(true);
        oldExportBtn.parentNode?.replaceChild(exportCsvBtn, oldExportBtn);
        exportCsvBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.task-select-cb:checked');
            if (checkedBoxes.length === 0) {
                alert('出力するタスクをチェックボックスで選択してください。');
                return;
            }
            let isCsvExported = false;
            // 竹高さんの完璧な既存ロジックを利用してタスクを抽出
            const checkedIds = Array.from(checkedBoxes).map(cb => Number(cb.getAttribute('data-id')));
            const exportTasks = tasks.filter((t) => checkedIds.includes(t.id));
            // 🌟🌟🌟 ここから追加：⑦ 養育特例のインターセプト処理 🌟🌟🌟
            const youikuTasks = exportTasks.filter((t) => t.title && t.title.includes('養育期間標準報酬月額特例申出書'));
            if (youikuTasks.length > 0) {
                // 1. CSVヘッダーの作成（養育特例の一般的なフォーマット）
                let csvContent = "被保険者整理番号,氏名,生年月日,基礎年金番号,申出年月日,養育開始年月日,子の氏名,子の生年月日\n";
                // 🌟 追加：既存のシステムに保存されている「従業員マスタ」を呼び出す
                const employeeMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                // 2. データの流し込み
                youikuTasks.forEach((task) => {
                    // ※ 現在のタスクカードには「従業員名」しか乗っていないため、
                    // 完璧にするならここで users コレクションや life_events コレクションからデータを引きます。
                    // 今回はCSVの枠組みを作るため、一旦ダミーと手入力枠を設けています。
                    const emp = employeeMasterDB[task.empName] || {};
                    // 🌟 ハードコードを消去！マスタのデータに置き換え（データが無い場合は"未設定"とする安全設計）
                    const empNo = emp.empId || "未設定";
                    const empName = task.empName;
                    const empDob = emp.dob || "未設定"; // 生年月日
                    const empPensionNo = emp.basicPensionNo || "未設定"; // 基礎年金番号
                    const applyDate = new Date().toISOString().split('T')[0]; // 申出日（今日）
                    const returnDate = task.deadline; // 復職日＝養育開始日
                    const cName = task.childName || "未設定";
                    const cDob = task.childBirthDate || "未設定";
                    // 🌟 全て動的な変数にチェンジ！
                    csvContent += `"${empNo}","${empName}","${empDob}","${empPensionNo}","${applyDate}","${returnDate}","${cName}","${cDob}"\n`;
                });
                // 3. BOM付与（Excel文字化け防止）とダウンロード実行
                const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
                const blob = new Blob([bom, csvContent], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `養育特例申出書_${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                // 出力後にチェックを外す
                checkedBoxes.forEach(cb => cb.checked = false);
                alert('✅ ⑦ 養育特例のCSVを出力しました！\n※子の氏名・生年月日はExcelで追記してください。');
                return; // 🛑 超重要：ここで処理を完全にストップし、他のCSVが出力されるのを防ぐ！
            }
            // ==========================================
            // 👶 ■ 産前産後休業取得者申出書/変更（終了）届（e-Govガチ仕様：全33項目）
            // ==========================================
            const sankyuTasks = exportTasks.filter((t) => t.title && (t.title.includes('産前産後') || t.title.includes('産休')));
            if (sankyuTasks.length > 0) {
                try {
                    // 🌟 1. 会社IDをローカルストレージから取得！
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("会社情報が読み込めません。");
                        return;
                    }
                    // 🌟 2. 【修正】会社情報マスタを「自社専用の箱」から取得！
                    let companyMaster = {};
                    const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
                    if (docSnap.exists()) {
                        companyMaster = docSnap.data();
                    }
                    else {
                        alert("⚠️ 会社情報が設定されていません。「法定料率・マスター」タブで保存してください。");
                        return;
                    }
                    // 🌟 3. 【超重要】必ず「自社の従業員」だけで絞り込んで取得！！！
                    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                    const usersSnap = await getDocs(usersQuery);
                    const firestoreUsersMap = {};
                    usersSnap.forEach((d) => {
                        const data = d.data();
                        const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                        firestoreUsersMap[fullName] = data;
                        firestoreUsersMap[fullName.replace(/\s+/g, '')] = data;
                    });
                    const localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                    // ==========================================
                    // 🌟 1. e-Gov用メタデータと和暦エンジン
                    // ==========================================
                    const csvMeta = {
                        mediaSeq: "001",
                        creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
                        repCode: "22737" // 🔥 修正：産前産後休業申出書のコードは「22737」！
                    };
                    const getEgoveDate = (dateStr) => {
                        if (!dateStr)
                            return { gengo: "", date: "" };
                        const d = new Date(dateStr);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        if (y >= 2019)
                            return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
                        if (y >= 1989)
                            return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
                        return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
                    };
                    // ==========================================
                    // 🌟 2. 会社情報の最強抽出エンジン（産休届にも搭載！）
                    // ==========================================
                    const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
                    const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
                    const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
                    const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
                    const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
                    const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
                    const zipSplit = rawZip.split('-');
                    const zip1 = zipSplit[0] || "";
                    const zip2 = zipSplit[1] || "";
                    const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
                    const telSplit = rawTel.split('-');
                    const tel1 = telSplit[0] || "";
                    const tel2 = telSplit[1] || "";
                    const tel3 = telSplit[2] || "";
                    const compName = companyMaster.companyName || companyMaster.name || "";
                    const repName = companyMaster.employerName || companyMaster.representativeName || "";
                    // ==========================================
                    // 🌟 3. 管理レコード（[kanri]ブロック）生成
                    // ==========================================
                    let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
                    csvContent += "[kanri]\n,001\n";
                    csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
                    csvContent += "[data]\n";
                    let exportCount = 0;
                    for (const targetTask of sankyuTasks) {
                        const targetEmpName = targetTask.empName.trim();
                        const localData = localMasterDB[targetEmpName] || localMasterDB[targetEmpName.replace(/\s+/g, '')] || {};
                        const cloudData = firestoreUsersMap[targetEmpName] || firestoreUsersMap[targetEmpName.replace(/\s+/g, '')] || {};
                        if (Object.keys(localData).length === 0 && Object.keys(cloudData).length === 0)
                            continue;
                        // 🌟 今回は全33項目！空文字で初期化してカンマのズレを完全防御！
                        const row = Array(33).fill("");
                        // 従業員マスタから基本情報を抽出
                        const empid = targetTask.empId || localData.empId || cloudData.employeeId || "";
                        const kana = cloudData.lastNameKana ? `${cloudData.lastNameKana} ${cloudData.firstNameKana}`.trim() : (localData.kana || "");
                        const myNumber = cloudData.myNumber || localData.myNumber || "";
                        const pensionNum = cloudData.basicPensionNumber || cloudData.pensionNumber || localData.pensionNumber || "";
                        // 🔥 修正：birthDate（大文字D）のブレ対策！
                        const rawDob = cloudData.birthdate || cloudData.birthDate || localData.dob || "";
                        const birthEGov = getEgoveDate(rawDob);
                        // 🍼 産休タスク特有の日付データを取得
                        const expectedBirthEGov = getEgoveDate(targetTask.expectedBirthDate || ""); // 出産予定日
                        const startLeaveEGov = getEgoveDate(targetTask.startDate || ""); // 産休開始日
                        const endLeaveEGov = getEgoveDate(targetTask.endDate || ""); // 産休終了予定日
                        const realBirthEGov = getEgoveDate(targetTask.realBirthDate || ""); // 実際の出産日（あれば）
                        const birthType = targetTask.birthType === "多胎" ? "2" : "1"; // 1:単胎, 2:多胎
                        // 🌟 1〜33番目：レコードのマッピング
                        row[0] = "2273700"; // 1. 様式コード
                        row[1] = prefCode; // 2. 都道府県コード ✨（キレイな変数に修正）
                        row[2] = cityCode; // 3. 郡市区符号 ✨（キレイな変数に修正）
                        row[3] = officeSymbol; // 4. 事業所記号 ✨（キレイな変数に修正）
                        row[4] = empid; // 5. 被保険者整理番号（★トラップ回避！）
                        row[5] = kana; // 6. 被保険者氏名（カナ）
                        row[6] = targetEmpName; // 7. 被保険者氏名（漢字）
                        row[7] = myNumber; // 8. 被保険者の個人番号
                        // 9. 課所符号（空欄）
                        row[9] = pensionNum; // 10. 一連番号（基礎年金番号）
                        row[10] = birthEGov.gengo; // 11. 生年月日_元号
                        row[11] = birthEGov.date; // 12. 生年月日_年月日
                        row[12] = expectedBirthEGov.gengo; // 13. 出産予定日_元号
                        row[13] = expectedBirthEGov.date; // 14. 出産予定日_年月日
                        row[14] = birthType; // 15. 出産種別 (1:単胎, 2:多胎)
                        row[15] = startLeaveEGov.gengo; // 16. 休業開始日_元号
                        row[16] = startLeaveEGov.date; // 17. 休業開始日_年月日
                        row[17] = endLeaveEGov.gengo; // 18. 休業終了予定日_元号
                        row[18] = endLeaveEGov.date; // 19. 休業終了予定日_年月日
                        // 20. 予備１（空欄）
                        // 21. 予備２（空欄）
                        row[21] = realBirthEGov.gengo; // 22. 実際の出産日_元号（無ければ空）
                        row[22] = realBirthEGov.date; // 23. 実際の出産日_年月日（無ければ空）
                        row[23] = ""; // 24. 備考
                        // ※25番目〜33番目は「変更・終了届」の場合の入力欄なので、新規申出の場合は空欄のままでOK！
                        csvContent += row.join(",") + "\n";
                        exportCount++;
                    }
                    if (exportCount > 0) {
                        // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（産休版）
                        const unicodeArray = Encoding.stringToCode(csvContent);
                        const sjisArray = Encoding.convert(unicodeArray, {
                            to: 'SJIS',
                            from: 'UNICODE'
                        });
                        const uint8Array = new Uint8Array(sjisArray);
                        const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
                        const link = document.createElement("a");
                        link.setAttribute("href", URL.createObjectURL(blob));
                        link.setAttribute("download", "SHFD0006.CSV");
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        alert(`✅ ${exportCount}件の産前産後休業取得者申出書(e-Gov仕様)を Shift-JIS で出力しました！`);
                        isCsvExported = true;
                    }
                }
                catch (error) {
                    console.error("産休CSV出力エラー:", error);
                    alert("産休CSVの生成中にエラーが発生しました。");
                }
            }
            // ==========================================
            // 👶 ■ 【真の完全版】育児休業等取得者申出書（e-Govガチ仕様：全52項目）
            // ==========================================
            const ikukyuTasks = exportTasks.filter((t) => t.title && t.title.includes('育児休業等取得者申出書'));
            if (ikukyuTasks.length > 0) {
                try {
                    // 🌟 1. 会社IDをローカルストレージから取得！
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("会社情報が読み込めません。");
                        return;
                    }
                    // 🌟 2. 【修正】会社情報マスタを「自社専用の箱」から取得！
                    let companyMaster = {};
                    const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
                    if (docSnap.exists()) {
                        companyMaster = docSnap.data();
                    }
                    else {
                        alert("⚠️ 会社情報が設定されていません。");
                        return;
                    }
                    // 🌟 3. 【超重要】必ず「自社の従業員」だけで絞り込んで取得！！！
                    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                    const usersSnap = await getDocs(usersQuery);
                    const firestoreUsersMap = {};
                    usersSnap.forEach((d) => {
                        const data = d.data();
                        const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                        firestoreUsersMap[fullName] = data;
                        firestoreUsersMap[fullName.replace(/\s+/g, '')] = data;
                    });
                    const localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                    // ==========================================
                    // 🌟 1. e-Gov用メタデータと和暦エンジン
                    // ==========================================
                    const csvMeta = {
                        mediaSeq: "001",
                        creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
                        repCode: "22637" // 🔥 修正：育児休業等取得者申出書のコードは「22637」！
                    };
                    const getEgoveDate = (dateStr) => {
                        if (!dateStr)
                            return { gengo: "", date: "" };
                        const d = new Date(dateStr);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        if (y >= 2019)
                            return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
                        if (y >= 1989)
                            return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
                        return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
                    };
                    // ==========================================
                    // 🌟 2. 会社情報の最強抽出エンジン（育休届にも搭載！）
                    // ==========================================
                    const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
                    const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
                    const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
                    const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
                    const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
                    const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
                    const zipSplit = rawZip.split('-');
                    const zip1 = zipSplit[0] || "";
                    const zip2 = zipSplit[1] || "";
                    const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
                    const telSplit = rawTel.split('-');
                    const tel1 = telSplit[0] || "";
                    const tel2 = telSplit[1] || "";
                    const tel3 = telSplit[2] || "";
                    const compName = companyMaster.companyName || companyMaster.name || "";
                    const repName = companyMaster.employerName || companyMaster.representativeName || "";
                    // ==========================================
                    // 🌟 3. 管理レコード（[kanri]ブロック）生成
                    // ==========================================
                    let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
                    csvContent += "[kanri]\n,001\n";
                    csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
                    csvContent += "[data]\n";
                    let exportCount = 0;
                    for (const targetTask of ikukyuTasks) {
                        const targetEmpName = targetTask.empName.trim();
                        const localData = localMasterDB[targetEmpName] || localMasterDB[targetEmpName.replace(/\s+/g, '')] || {};
                        const cloudData = firestoreUsersMap[targetEmpName] || firestoreUsersMap[targetEmpName.replace(/\s+/g, '')] || {};
                        if (Object.keys(localData).length === 0 && Object.keys(cloudData).length === 0)
                            continue;
                        // 🌟 竹高さんリストアップの全52項目！器を52マスに広げてカンマズレを完全防衛！
                        const row = Array(52).fill("");
                        const empid = targetTask.empId || localData.empId || cloudData.employeeId || "";
                        const kana = cloudData.lastNameKana ? `${cloudData.lastNameKana} ${cloudData.firstNameKana}`.trim() : (localData.kana || "");
                        const myNumber = cloudData.myNumber || localData.myNumber || "";
                        const pensionNum = cloudData.basicPensionNumber || cloudData.pensionNumber || localData.pensionNumber || "";
                        // 🔥 修正：生年月日の大文字・小文字ブレ対策（安全網）
                        const rawDob = cloudData.birthdate || cloudData.birthDate || localData.dob || "";
                        const birthEGov = getEgoveDate(rawDob);
                        const startLeaveEGov = getEgoveDate(targetTask.startDate || ""); // 育休開始日
                        const endLeaveEGov = getEgoveDate(targetTask.endDate || ""); // 育休終了予定日
                        // 🌟 1〜13番目：被保険者（従業員）の基本マッピング
                        row[0] = "2263700"; // 1. 様式コード
                        row[1] = prefCode; // 2. 都道府県コード ✨（キレイな変数に修正）
                        row[2] = cityCode; // 3. 郡市区符号 ✨（キレイな変数に修正）
                        row[3] = officeSymbol; // 4. 事業所記号 ✨（キレイな変数に修正）
                        row[4] = empid; // 5. 被保険者整理番号
                        row[5] = kana; // 6. 被保険者氏名（カナ）
                        row[6] = targetEmpName; // 7. 被保険者氏名（漢字）
                        row[7] = myNumber; // 8. 被保険者の個人番号
                        // 9. 課所符号（空欄）
                        row[9] = pensionNum; // 10. 一連番号（基礎年金番号）
                        row[10] = birthEGov.gengo; // 11. 元号（被保険者生年月日）
                        row[11] = birthEGov.date; // 12. 年月日（被保険者生年月日）
                        row[12] = cloudData.gender === "女性" ? "2" : "1"; // 13. 被保険者の性別
                        // 🌟 14〜18番目：【神連動】Firestoreの家族データから生まれたばかりの「子」を自動検知！
                        const dependents = cloudData.dependents || [];
                        const baby = dependents.find((d) => d.relationship && (d.relationship.includes("子") || d.relationship.includes("娘") || d.relationship.includes("息子")));
                        if (baby) {
                            const bBirth = getEgoveDate(baby.birthDate || baby.birthdate || "");
                            row[13] = `${baby.lastNameKana || ""} ${baby.firstNameKana || ""}`.trim(); // 14. 養育する子の氏名（カナ）
                            row[14] = `${baby.lastName || ""} ${baby.firstName || ""}`.trim(); // 15. 養育する子の氏名（漢字）
                            row[15] = bBirth.gengo; // 16. 元号（養育する子の生年月日）
                            row[16] = bBirth.date; // 17. 年月日（養育する子の生年月日）
                            row[17] = "1"; // 18. 区分（1:実子, 2:養子等 / 通常は1固定）
                        }
                        // 19〜20番目：養育開始年月日（実子以外の場合のみなので空欄でOK）
                        // 🌟 21〜28番目：育休期間・日数のマッピング
                        row[20] = startLeaveEGov.gengo; // 21. 元号（育児休業等開始年月日）
                        row[21] = startLeaveEGov.date; // 22. 年月日（育児休業等開始年月日）
                        row[22] = endLeaveEGov.gengo; // 23. 元号（育児休業等終了（予定）年月日）
                        row[23] = endLeaveEGov.date; // 24. 年月日（育児休業等終了（予定）年月日）
                        row[24] = ""; // 25. 育児休業等取得日数（空欄で役所側自動計算）
                        row[25] = "0"; // 26. 就業予定日数（初期申請時は0固定）
                        row[26] = ""; // 27. パパママ育休プラス該当区分
                        row[27] = ""; // 28. 備考
                        // 🌟 29〜52番目（インデックス28〜51）：延長・変更・第1〜4工区の内訳用
                        // 新規申請時はすべて自動で空欄（,,,,）のまま綺麗に後ろにカンマが結合されます！
                        csvContent += row.join(",") + "\n";
                        exportCount++;
                    }
                    if (exportCount > 0) {
                        // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（産休版）
                        const unicodeArray = Encoding.stringToCode(csvContent);
                        const sjisArray = Encoding.convert(unicodeArray, {
                            to: 'SJIS',
                            from: 'UNICODE'
                        });
                        const uint8Array = new Uint8Array(sjisArray);
                        const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
                        const link = document.createElement("a");
                        link.setAttribute("href", URL.createObjectURL(blob));
                        link.setAttribute("download", "SHFD0006.CSV");
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        alert(`✅ ${exportCount}件の育休休業取得者申出書(e-Gov仕様)を Shift-JIS で出力しました！`);
                        isCsvExported = true;
                    }
                }
                catch (error) {
                    console.error("育休CSV出力エラー:", error);
                    alert("育休CSVの生成中にエラーが発生しました。");
                }
            }
            // 1. 【追加（取得）】のCSV処理
            // ==========================================
            // 🌟 ■ 被扶養者（異動）届（e-Govガチ仕様：全182項目）
            // ==========================================
            const huyoTasks = exportTasks.filter((t) => t.title && (t.title.includes('被扶養者異動届') || t.title.includes('扶養')));
            if (huyoTasks.length > 0) {
                try {
                    // 🌟 1. 会社IDをローカルストレージから取得！
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("会社情報が読み込めません。");
                        return;
                    }
                    // 🌟 2. 【修正】会社情報マスタを「自社専用の箱」から取得するように変更！
                    let companyMaster = {};
                    const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
                    if (docSnap.exists()) {
                        companyMaster = docSnap.data();
                    }
                    else {
                        alert("⚠️ 会社情報が設定されていません。「法定料率・マスター」タブで保存してください。");
                        return;
                    }
                    // 🌟 3. 【超重要】全社員ではなく、必ず「自社の従業員」だけで絞り込んで取得！！！
                    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                    const usersSnap = await getDocs(usersQuery);
                    const firestoreUsersMap = {};
                    usersSnap.forEach((d) => {
                        const data = d.data();
                        const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                        firestoreUsersMap[fullName] = data;
                        firestoreUsersMap[fullName.replace(/\s+/g, '')] = data;
                    });
                    const csvMeta = {
                        mediaSeq: "001",
                        creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
                        repCode: "22223"
                    };
                    const getEgoveDate = (dateStr) => {
                        if (!dateStr)
                            return { gengo: "", date: "" };
                        const d = new Date(dateStr);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        if (y >= 2019)
                            return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
                        if (y >= 1989)
                            return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
                        return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
                    };
                    // 管理レコード生成
                    let csvContent = `${companyMaster.prefCode || ""},${companyMaster.cityCode || ""},${companyMaster.officeSymbol || ""},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
                    csvContent += "[kanri]\n,001\n";
                    csvContent += `${companyMaster.prefCode || ""},${companyMaster.cityCode || ""},${companyMaster.officeSymbol || ""},${companyMaster.officeNumber || ""},${companyMaster.zip1 || ""},${companyMaster.zip2 || ""},${companyMaster.address || ""},${companyMaster.companyName || ""},${companyMaster.employerName || ""},${companyMaster.tel1 || ""},${companyMaster.tel2 || ""},${companyMaster.tel3 || ""}\n`;
                    csvContent += "[data]\n";
                    let exportCount = 0;
                    const localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                    for (const targetTask of huyoTasks) {
                        const targetEmpName = targetTask.empName.trim();
                        const localData = localMasterDB[targetEmpName] || localMasterDB[targetEmpName.replace(/\s+/g, '')] || {};
                        const cloudData = firestoreUsersMap[targetEmpName] || firestoreUsersMap[targetEmpName.replace(/\s+/g, '')] || {};
                        if (Object.keys(localData).length === 0 && Object.keys(cloudData).length === 0)
                            continue;
                        // 🌟 182個の「すべて空文字」の配列を最初に作成する（これでカンマのズレを完全に防ぐ！）
                        const row = Array(182).fill("");
                        // 被保険者（社員本人）の情報抽出
                        const empid = targetTask.empId || localData.empId || cloudData.employeeId || "";
                        const kana = cloudData.lastNameKana ? `${cloudData.lastNameKana} ${cloudData.firstNameKana}`.trim() : (localData.kana || "");
                        const myNumber = cloudData.myNumber || localData.myNumber || "";
                        const birthEGov = getEgoveDate(cloudData.birthdate || localData.dob || "");
                        const zip1 = companyMaster.zip1 || "";
                        const zip2 = companyMaster.zip2 || "";
                        const address = cloudData.address || localData.address || "";
                        // 🌟 1〜21番目：被保険者レコードのマッピング
                        row[0] = "2202700"; // 1. 様式コード
                        row[1] = companyMaster.prefCode || ""; // 2. 都道府県コード
                        row[2] = companyMaster.cityCode || ""; // 3. 郡市区符号
                        row[3] = companyMaster.officeSymbol || ""; // 4. 事業所記号
                        row[4] = "1"; // 5. 事業主確認欄（1固定）
                        row[5] = csvMeta.creationDate.substring(0, 1); // 6. 受付元号
                        row[6] = csvMeta.creationDate; // 7. 受付年月日
                        row[7] = empid; // 8. 被保険者整理番号
                        row[8] = kana; // 9. 氏名カナ
                        row[9] = targetEmpName; // 10. 氏名漢字
                        row[10] = birthEGov.gengo; // 11. 生年月日_元号
                        row[11] = birthEGov.date; // 12. 生年月日_年月日
                        row[12] = cloudData.gender === "女性" ? "2" : "1"; // 13. 性別
                        row[13] = myNumber; // 14. 個人番号
                        row[17] = zip1; // 18. 郵便番号（親）
                        row[18] = zip2; // 19. 郵便番号（子）
                        row[19] = address; // 20. 被保険者住所
                        row[20] = targetTask.title.includes('喪失') ? "2" : "1"; // 21. 異動の別（1:取得、2:喪失）
                        // ==========================================
                        // 👨‍👩‍👧‍👦 扶養家族データの流し込み（実際のFirestore構造に完全適合！）
                        // ==========================================
                        const dependents = cloudData.dependents || [];
                        // 🌟 補助関数：文字の変換ロジック
                        const getLivingCode = (status) => status === "同居" ? "1" : "2"; // 1:同居, 2:別居
                        const getRelationCode = (rel) => {
                            if (rel.includes("子"))
                                return "3";
                            if (rel.includes("父"))
                                return "1";
                            if (rel.includes("母"))
                                return "2";
                            return "0"; // その他
                        };
                        // 1. 配偶者枠（22〜69番目）
                        const spouse = dependents.find((d) => d.relationship === "配偶者" || d.relationship === "妻" || d.relationship === "夫");
                        if (spouse) {
                            const sBirth = getEgoveDate(spouse.birthDate); // DB通りDを大文字に
                            const sEvent = getEgoveDate(spouse.eventDate || targetTask.deadline);
                            const sFullName = `${spouse.lastName || ""} ${spouse.firstName || ""}`.trim();
                            const sKana = `${spouse.lastNameKana || ""} ${spouse.firstNameKana || ""}`.trim();
                            row[21] = sEvent.gengo; // 22. 届出日_元号
                            row[22] = sEvent.date; // 23. 届出日_年月日
                            row[23] = sKana; // 24. 氏名カナ
                            row[24] = sFullName; // 25. 氏名漢字
                            row[25] = sBirth.gengo; // 26. 生年月日_元号
                            row[26] = sBirth.date; // 27. 生年月日_年月日
                            row[27] = spouse.relationship === "夫" ? "1" : "2"; // 28. 性別(続柄) 1:夫 2:妻
                            row[28] = spouse.myNumber || ""; // 29. 個人番号
                            row[34] = getLivingCode(spouse.livingStatus); // 35. 同居・別居フラグ
                            row[43] = sEvent.gengo; // 44. 理由発生_元号
                            row[44] = sEvent.date; // 45. 理由発生_年月日
                            row[45] = row[20] === "1" ? "01" : ""; // 46. 取得理由（01:出生/婚姻等）
                            row[48] = spouse.annualIncome || "0"; // 49. 収入
                            if (row[20] === "2")
                                row[51] = "01"; // 52. 喪失理由（01:就職等）
                            row[67] = spouse.annualIncome || "0"; // 68. 配偶者の年間収入
                        }
                        // 2. その他の被扶養者1（子など：70〜108番目）
                        const child1 = dependents.filter((d) => d.relationship !== "配偶者" && d.relationship !== "妻" && d.relationship !== "夫")[0];
                        if (child1) {
                            const cBirth = getEgoveDate(child1.birthDate);
                            const cEvent = getEgoveDate(child1.eventDate || targetTask.deadline);
                            const cFullName = `${child1.lastName || ""} ${child1.firstName || ""}`.trim();
                            const cKana = `${child1.lastNameKana || ""} ${child1.firstNameKana || ""}`.trim();
                            row[69] = "1"; // 70. 被扶養者番号
                            row[70] = cKana; // 71. 氏名カナ
                            row[71] = cFullName; // 72. 氏名漢字
                            row[72] = cBirth.gengo; // 73. 生年月日_元号
                            row[73] = cBirth.date; // 74. 生年月日_年月日
                            row[74] = child1.gender === "女性" ? "2" : "1"; // 75. 性別
                            row[75] = getRelationCode(child1.relationship); // 76. 続柄コード
                            row[78] = child1.myNumber || ""; // 79. 個人番号
                            row[79] = getLivingCode(child1.livingStatus); // 80. 同居・別居フラグ
                            row[91] = cEvent.gengo; // 92. 理由発生_元号
                            row[92] = cEvent.date; // 93. 理由発生_年月日
                            row[94] = child1.annualIncome || "0"; // 95. 収入
                            row[95] = row[20] === "1" ? "1" : ""; // 96. 取得理由
                            if (row[20] === "2")
                                row[97] = "1"; // 98. 喪失理由
                        }
                        // 3. その他の被扶養者2（109〜147番目）
                        const child2 = dependents.filter((d) => d.relationship !== "配偶者" && d.relationship !== "妻" && d.relationship !== "夫")[1];
                        if (child2) {
                            const cBirth = getEgoveDate(child2.birthDate);
                            const cEvent = getEgoveDate(child2.eventDate || targetTask.deadline);
                            const cFullName = `${child2.lastName || ""} ${child2.firstName || ""}`.trim();
                            const cKana = `${child2.lastNameKana || ""} ${child2.firstNameKana || ""}`.trim();
                            row[108] = "2";
                            row[109] = cKana;
                            row[110] = cFullName;
                            row[111] = cBirth.gengo;
                            row[112] = cBirth.date;
                            row[113] = child2.gender === "女性" ? "2" : "1";
                            row[114] = getRelationCode(child2.relationship);
                            row[117] = child2.myNumber || "";
                            row[118] = getLivingCode(child2.livingStatus);
                            row[130] = cEvent.gengo;
                            row[131] = cEvent.date;
                            row[133] = child2.annualIncome || "0";
                            row[134] = row[20] === "1" ? "1" : "";
                            if (row[20] === "2")
                                row[136] = "1";
                        }
                        // 4. その他の被扶養者3（148〜178番目）
                        const child3 = dependents.filter((d) => d.relationship !== "配偶者" && d.relationship !== "妻" && d.relationship !== "夫")[2];
                        if (child3) {
                            const cBirth = getEgoveDate(child3.birthDate);
                            const cEvent = getEgoveDate(child3.eventDate || targetTask.deadline);
                            const cFullName = `${child3.lastName || ""} ${child3.firstName || ""}`.trim();
                            const cKana = `${child3.lastNameKana || ""} ${child3.firstNameKana || ""}`.trim();
                            row[147] = "3";
                            row[148] = cKana;
                            row[149] = cFullName;
                            row[150] = cBirth.gengo;
                            row[151] = cBirth.date;
                            row[152] = child3.gender === "女性" ? "2" : "1";
                            row[153] = getRelationCode(child3.relationship);
                            row[156] = child3.myNumber || "";
                            row[157] = getLivingCode(child3.livingStatus);
                            row[169] = cEvent.gengo;
                            row[170] = cEvent.date;
                            row[172] = child3.annualIncome || "0";
                            row[173] = row[20] === "1" ? "1" : "";
                            if (row[20] === "2")
                                row[175] = "1";
                        }
                        // 🌟 179〜182番目：末尾の共通フラグ
                        row[178] = "1"; // 179. 届出意思確認済（1:確認済）
                        row[179] = "1"; // 180. 資格確認書発行要否(配偶者)（1:不要）
                        row[180] = child1 ? "1" : ""; // 181. 資格確認書発行要否(子1)
                        row[181] = child2 ? "1" : ""; // 182. 資格確認書発行要否(子2)
                        csvContent += row.join(",") + "\n";
                        exportCount++;
                    }
                    if (exportCount === 0) {
                        alert("マスターデータと一致する対象者が見ねつかりませんでした。");
                        return;
                    }
                    // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（被扶養者異動届版）
                    const unicodeArray = Encoding.stringToCode(csvContent);
                    const sjisArray = Encoding.convert(unicodeArray, {
                        to: 'SJIS',
                        from: 'UNICODE'
                    });
                    const uint8Array = new Uint8Array(sjisArray);
                    const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
                    const link = document.createElement("a");
                    link.setAttribute("href", URL.createObjectURL(blob));
                    link.setAttribute("download", "SHFD0006.CSV"); // ガチ仕様ファイル名
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    alert(`✅ ${exportCount}件の被扶養者異動届(e-Gov仕様)を Shift-JIS で出力しました！`);
                    isCsvExported = true;
                    return;
                }
                catch (error) {
                    console.error("CSV出力エラー:", error);
                    alert("CSVの生成中にエラーが発生しました。");
                    return;
                }
            }
            // 2. 【削除（喪失）】のCSV処理
            const huyoRemoveTasks = exportTasks.filter((t) => t.title && t.title.includes('被扶養者異動届（喪失）'));
            if (huyoRemoveTasks.length > 0) {
                let csvContent = "社員番号,社員氏名,外す家族の氏名,喪失理由,喪失年月日,区分\n";
                const employeeMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                huyoRemoveTasks.forEach((task) => {
                    const emp = employeeMasterDB[task.empName] || {};
                    csvContent += `"${emp.empId || ''}","${task.empName}","${task.targetFamilyName || 'Excelで入力'}","${task.removeReason || '就職'}","${task.deadline || ''}","喪失（削除）"\n`;
                });
                downloadCSV(csvContent, `健康保険_被扶養者異動届(喪失)_${new Date().toISOString().split('T')[0]}.csv`);
                alert('✅ 扶養削除（喪失）のCSVを出力しました！\n※返却された健康保険証の現物を役所に添付して提出してください。');
                return; // 処理ストップ
            }
            // // ==========================================
            // // 🚪 退社（資格喪失）のCSV処理
            // // ==========================================
            // const lossTasks = exportTasks.filter((t: any) => t.title && t.title.includes('被保険者資格喪失届'));
            // if (lossTasks.length > 0) {
            //     // e-Govの資格喪失届に合わせたヘッダー
            //     let csvContent = "社員番号,社員氏名,喪失年月日,喪失原因,保険証回収枚数,備考\n";
            //     lossTasks.forEach((task: any) => {
            //         // 退社ウィザードで入力された「保険証の返却方法」をメモから抽出する簡易処理
            //         let returnStatus = "不明";
            //         if (task.memo && task.memo.includes('保険証返却')) {
            //             returnStatus = task.memo.split('【保険証返却】')[1].split('\n')[0].trim();
            //         }
            //         // 🌟 注意：現状タスクには社員番号がないため、名前などを出力します
            //         csvContent += `"${task.empId || ''}","${task.empName}","${task.deadline}","退職","Excelで入力","${returnStatus}"\n`;
            //     });
            //     downloadCSV(csvContent, "SHFD0006.CSV");
            //     alert('✅ 資格喪失届のCSVを出力しました！\n※保険証の回収枚数などはExcelで追記してe-Govへアップロードしてください。');
            //     return; // 処理ストップ
            // }
            // ==========================================
            // 🌟 ■ 退社（資格喪失）のCSV処理（e-Govガチ仕様！）
            // ==========================================
            // 「喪失」「退職」「後期高齢者」を含むタスクを拾い上げる
            const lossTasks = exportTasks.filter((t) => t.title && (t.title.includes('喪失') || t.title.includes('退職') || t.title.includes('後期高齢者')));
            if (lossTasks.length > 0) {
                try {
                    // 🌟 1. 会社IDをローカルストレージから取得！
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("会社情報が読み込めません。");
                        return;
                    }
                    // 🌟 2. 【修正】会社情報マスタを「自社専用の箱」から取得！
                    let companyMaster = {};
                    const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
                    if (docSnap.exists()) {
                        companyMaster = docSnap.data();
                    }
                    else {
                        alert("⚠️ 会社情報が設定されていません。「法定料率・マスター」タブで保存してください。");
                        return;
                    }
                    // 🌟 3. 【超重要】必ず「自社の従業員」だけで絞り込んで取得！！！
                    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                    const usersSnap = await getDocs(usersQuery);
                    const firestoreUsersMap = {};
                    usersSnap.forEach((d) => {
                        const data = d.data();
                        const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                        firestoreUsersMap[fullName] = data;
                        firestoreUsersMap[fullName.replace(/\s+/g, '')] = data;
                    });
                    // ==========================================
                    // 🌟 1. e-Gov用メタデータ（喪失届用）
                    // ==========================================
                    const csvMeta = {
                        mediaSeq: "001",
                        creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
                        repCode: "22017" // 🚨 修正：資格喪失届のコード「22017」に変更！
                    };
                    const getEgoveDate = (dateStr) => {
                        if (!dateStr)
                            return { gengo: "", date: "" };
                        const d = new Date(dateStr);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        if (y >= 2019)
                            return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
                        if (y >= 1989)
                            return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
                        return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
                    };
                    // ==========================================
                    // 🌟 2. 会社マスタの抽出（直下・mainBranch両方探す最強エンジン）
                    // ==========================================
                    const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
                    const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
                    const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
                    const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
                    const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
                    // 郵便番号のハイフン分割
                    const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
                    const zipSplit = rawZip.split('-');
                    const zip1 = zipSplit[0] || "";
                    const zip2 = zipSplit[1] || "";
                    // 電話番号のハイフン分割
                    const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
                    const telSplit = rawTel.split('-');
                    const tel1 = telSplit[0] || "";
                    const tel2 = telSplit[1] || "";
                    const tel3 = telSplit[2] || "";
                    // 会社名と代表者名
                    const compName = companyMaster.companyName || companyMaster.name || "";
                    const repName = companyMaster.employerName || companyMaster.representativeName || "";
                    // ==========================================
                    // 🌟 3. CSVヘッダー（kanriブロック）の組み立て
                    // ==========================================
                    let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
                    csvContent += `[kanri]\n`;
                    csvContent += `,001\n`;
                    csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
                    csvContent += `[data]\n`;
                    let exportCount = 0;
                    const localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
                    for (const targetTask of lossTasks) {
                        const targetEmpName = targetTask.empName.trim();
                        const localData = localMasterDB[targetEmpName] || localMasterDB[targetEmpName.replace(/\s+/g, '')] || {};
                        const cloudData = firestoreUsersMap[targetEmpName] || firestoreUsersMap[targetEmpName.replace(/\s+/g, '')] || {};
                        if (Object.keys(localData).length === 0 && Object.keys(cloudData).length === 0)
                            continue;
                        const empid = targetTask.empId || localData.empId || cloudData.employeeId || "";
                        const kanji = targetEmpName;
                        const kana = cloudData.lastNameKana ? `${cloudData.lastNameKana} ${cloudData.firstNameKana}`.trim() : (localData.kana || "");
                        const myNumber = cloudData.myNumber || localData.myNumber || "";
                        const pensionNum = cloudData.basicPensionNumber || cloudData.pensionNumber || localData.pensionNumber || "";
                        const rawDob = cloudData.birthdate || localData.dob || "";
                        const birthEGov = getEgoveDate(rawDob);
                        const birthDate = rawDob ? new Date(rawDob) : null;
                        // 🌟 70歳/75歳の法律対応ロジック
                        let lossReason = "4";
                        let retireEGov = { gengo: "", date: "" };
                        let lossEGov = { gengo: "", date: "" };
                        if (targetTask.title.includes('厚生年金喪失') && birthDate) {
                            const age70Date = new Date(birthDate.getFullYear() + 70, birthDate.getMonth(), birthDate.getDate() - 1);
                            lossEGov = getEgoveDate(age70Date.toISOString());
                            lossReason = "4";
                        }
                        else if (targetTask.title.includes('後期高齢者') && birthDate) {
                            const age75Date = new Date(birthDate.getFullYear() + 75, birthDate.getMonth(), birthDate.getDate());
                            lossEGov = getEgoveDate(age75Date.toISOString());
                            lossReason = "7";
                        }
                        else {
                            const retireDateStr = targetTask.deadline || "";
                            if (retireDateStr) {
                                const rDate = new Date(retireDateStr);
                                retireEGov = getEgoveDate(rDate.toISOString());
                                const lDate = new Date(rDate);
                                lDate.setDate(lDate.getDate() + 1);
                                lossEGov = getEgoveDate(lDate.toISOString());
                            }
                        }
                        let returnStatus = "不明";
                        if (targetTask.memo && targetTask.memo.includes('【保険証返却】')) {
                            returnStatus = targetTask.memo.split('【保険証返却】')[1].split('\n')[0].trim();
                        }
                        const isReturned = returnStatus.includes("済") || returnStatus.includes("回収");
                        const attachedCount = isReturned ? "1" : "0";
                        const unreturnedCount = isReturned ? "0" : "1";
                        // 🌟 修正：抽出したきれいな変数（prefCode等）を使うように変更
                        const row = [
                            "2201700", prefCode, cityCode, officeSymbol, officeNumber,
                            empid, kana, kanji, birthEGov.gengo, birthEGov.date, myNumber, "",
                            pensionNum, lossEGov.gengo, lossEGov.date, lossReason, retireEGov.gengo, retireEGov.date,
                            "", "", "", attachedCount, unreturnedCount, "", "", "", ""
                        ];
                        csvContent += row.join(",") + "\n";
                        exportCount++;
                    }
                    if (exportCount === 0) {
                        alert("マスターデータと一致する対象者が見つかりませんでした。");
                        return;
                    }
                    // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（被扶養者異動届版）
                    const unicodeArray = Encoding.stringToCode(csvContent);
                    const sjisArray = Encoding.convert(unicodeArray, {
                        to: 'SJIS',
                        from: 'UNICODE'
                    });
                    const uint8Array = new Uint8Array(sjisArray);
                    const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
                    const link = document.createElement("a");
                    link.setAttribute("href", URL.createObjectURL(blob));
                    link.setAttribute("download", "SHFD0006.CSV"); // ガチ仕様ファイル名
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    alert(`✅ ${exportCount}件の資格喪失届(e-Gov仕様)を Shift-JIS で出力しました！`);
                    isCsvExported = true;
                }
                catch (error) {
                    console.error("CSV出力エラー:", error);
                    alert("CSVの生成中にエラーが発生しました。");
                    return;
                }
            }
            // ==========================================
            // 💳 保険証再発行（き損・紛失）のCSV処理
            // ==========================================
            const reissueTasks = exportTasks.filter((t) => t.title && t.title.includes('被保険者証再交付申請書'));
            if (reissueTasks.length > 0) {
                let csvContent = "社員番号,社員氏名,申請理由,事象発生年月日,警察届出,備考詳細\n";
                reissueTasks.forEach((task) => {
                    // メモ欄から理由や警察の届出状況を抽出
                    let reason = "不明";
                    let police = "-";
                    let memoDetails = "なし";
                    if (task.memo) {
                        if (task.memo.includes('【申請理由】'))
                            reason = task.memo.split('【申請理由】')[1].split('\n')[0].trim();
                        if (task.memo.includes('【警察届出】'))
                            police = task.memo.split('【警察届出】')[1].split('\n')[0].trim();
                        if (task.memo.includes('【備考】'))
                            memoDetails = task.memo.split('【備考】')[1].split('\n')[0].trim();
                    }
                    csvContent += `"${task.empId || ''}","${task.empName}","${reason}","Excelで入力","${police}","${memoDetails}"\n`;
                });
                downloadCSV(csvContent, `健康保険_被保険者証再交付申請書_${new Date().toISOString().split('T')[0]}.csv`);
                alert('✅ 保険証再交付申請書のCSVを出力しました！\n※事象発生日などの詳細はExcelで確認・追記してください。');
                isCsvExported = true;
                return; // 処理ストップ
            }
            // 🌟 月変タスクが含まれているかチェック
            const geppenTasks = exportTasks.filter((t) => t.title && t.title.includes('月額変更届'));
            if (geppenTasks.length > 0) {
                // 月変タスクの場合は、最強エンジンを起動！
                const targetTask = geppenTasks[0];
                const tYear = targetTask.targetYear || new Date().getFullYear();
                const tMonth = targetTask.targetMonth || (new Date().getMonth() + 1);
                const targetEmpName = targetTask.empName;
                if (typeof downloadGeppenCSV === 'function') {
                    downloadGeppenCSV(tYear, tMonth, targetEmpName);
                }
                else {
                    window.downloadGeppenCSV(tYear, tMonth);
                }
                // 出力後にチェックを外す
                checkedBoxes.forEach(cb => cb.checked = false);
                return; // 💡 超重要：ここで処理を完全にストップし、下にある既存のマスター照合エラーを防ぐ！
            }
            // 🌟🌟🌟 ここから追加：【賞与支払届】のインターセプト（横取り）処理 🌟🌟🌟
            const shoyoTasks = exportTasks.filter((t) => t.title && t.title.includes('賞与支払届'));
            if (shoyoTasks.length > 0) {
                const targetTask = shoyoTasks[0];
                const tDate = targetTask.targetPaymentDate; // 先ほどタスクに仕込んだ支給日！
                if (!tDate) {
                    alert("タスクに支給日のデータがありません。");
                    return;
                }
                // 最強の賞与CSVエンジンを起動！
                if (typeof downloadShoyoCSV === 'function') {
                    downloadShoyoCSV(tDate);
                }
                else {
                    window.downloadShoyoCSV(tDate);
                }
                // 出力後にチェックを外す
                checkedBoxes.forEach(cb => cb.checked = false);
                return; // 💡 超重要：ここで処理を完全にストップし、エラーを防ぐ！
            }
            // 🌟🌟🌟 追加ここまで 🌟🌟🌟
            // 💡 新・賢いロジック：選択されたタスクの「提出先（agency）」を抽出してチェックする
            const agencies = Array.from(new Set(exportTasks.map((t) => t.agency || '社内')));
            // もし「年金事務所」と「ハローワーク」など、違うフォーマットが混ざっていたらエラー
            if (agencies.length > 1) {
                alert('【エラー】提出先（フォーマット）が異なるタスクが混在しています。\n同じ提出先のタスクのみを選択して出力してください。');
                return;
            }
            // 🌟 ガチ仕様エンジンで処理されなかったタスクが残っている場合はエラーで弾く！
            if (!isCsvExported) {
                alert("⚠️ 選択されたタスクは現在のCSV出力（e-Gov連携）の対象外です。");
            }
            return;
        });
    }
    // --- 既存のフィルター・ソート・アーカイブ機能群 ---
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.style.background = '#e9ecef';
                b.style.color = '#333';
            });
            const target = e.currentTarget;
            target.style.background = '#333';
            target.style.color = '#fff';
            currentFilter = target.getAttribute('data-filter') || 'all';
            renderTasks();
        });
    });
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => { currentSort = e.target.value; renderTasks(); });
    }
    const archiveAllBtn = document.getElementById('btn-archive-all');
    if (archiveAllBtn) {
        archiveAllBtn.addEventListener('click', () => {
            tasks = tasks.map((t) => t.status === 'done' ? { ...t, status: 'archive' } : t);
            localStorage.setItem(taskKey, JSON.stringify(tasks)); // 🌟 自分の会社のタスクだけを更新！
            renderTasks();
        });
    }
    const clearBtn = document.getElementById('btn-clear-tasks');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('本当にすべてのタスクデータを消去しますか？（デバッグ用）')) {
                localStorage.setItem(taskKey, '[]'); // 🌟 自分の会社のタスクだけを空っぽに！
                tasks = [];
                renderTasks();
            }
        });
    }
    // アーカイブモーダル関連
    const archiveBtn = document.getElementById('btn-show-archive');
    const archiveModal = document.getElementById('archive-modal');
    const archiveCloseBtn = document.getElementById('btn-close-archive');
    const archiveList = document.getElementById('archive-list');
    const emptyArchiveBtn = document.getElementById('btn-empty-archive');
    const renderArchiveList = () => {
        if (!archiveList)
            return;
        const archivedTasks = tasks.filter((t) => t.status === 'archive');
        if (archivedTasks.length === 0) {
            archiveList.innerHTML = `<div style="text-align: center; color: #999; padding: 40px; font-weight: bold;">アーカイブされたタスクはありません</div>`;
        }
        else {
            archiveList.innerHTML = archivedTasks.map((t) => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
          <div>
            <div style="font-size: 11px; color: #666; margin-bottom: 4px;">🏢 ${t.agency || '不明'} ｜ 発生元: ${t.source}</div>
            <div style="font-weight: bold; color: #333; font-size: 14px;">${t.title}</div>
            <div style="font-size: 12px; color: #666;">対象: <b>${t.empName}</b></div>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="restore-btn" data-id="${t.id}" style="background: #28a745; color: #fff; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">🔄 復元</button>
            <button class="delete-btn" data-id="${t.id}" style="background: #dc3545; color: #fff; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">🗑️ 完全削除</button>
          </div>
        </div>
      `).join('');
            document.querySelectorAll('.restore-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = Number(e.currentTarget.getAttribute('data-id'));
                    tasks = tasks.map((t) => t.id === id ? { ...t, status: 'done' } : t);
                    localStorage.setItem(taskKey, JSON.stringify(tasks));
                    renderArchiveList();
                    renderTasks(); // 🌟 専用キーで保存！
                });
            });
            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (confirm('このタスクを完全に削除しますか？')) {
                        const id = Number(e.currentTarget.getAttribute('data-id'));
                        tasks = tasks.filter((t) => t.id !== id);
                        localStorage.setItem(taskKey, JSON.stringify(tasks));
                        renderArchiveList(); // 🌟 専用キーで保存！
                    }
                });
            });
        }
    };
    if (archiveBtn && archiveModal && archiveCloseBtn) {
        archiveBtn.addEventListener('click', () => { renderArchiveList(); archiveModal.style.display = 'flex'; });
        archiveCloseBtn.addEventListener('click', () => { archiveModal.style.display = 'none'; renderTasks(); });
    }
    if (emptyArchiveBtn) {
        emptyArchiveBtn.addEventListener('click', () => {
            const archivedCount = tasks.filter((t) => t.status === 'archive').length;
            if (archivedCount === 0)
                return;
            if (confirm(`アーカイブ内の ${archivedCount} 件のタスクをすべて完全削除しますか？`)) {
                tasks = tasks.filter((t) => t.status !== 'archive');
                localStorage.setItem(taskKey, JSON.stringify(tasks));
                renderArchiveList(); // 🌟 専用キーで保存！
            }
        });
    }
    renderTasks();
}
// 💡 法定料率・マスタータブのHTMLを読み込み、動きをつける関数
async function loadInsuranceMasterTab() {
    const container = document.getElementById('tab-settings');
    if (!container)
        return;
    try {
        const response = await fetch('/src/tab-insurance-master.html');
        if (!response.ok)
            throw new Error('法定料率マスターの読み込みに失敗しました');
        container.innerHTML = await response.text();
        // --- 要素の取得 ---
        const radioInputs = document.querySelectorAll('input[name="ins-type"]');
        const kyokaiSection = document.getElementById('kyokai-section');
        const kumiaiSection = document.getElementById('kumiai-section');
        // 💡 NEW: 子育て関連の要素取得
        const inputChildContribution = document.getElementById('input-child-contribution');
        const inputChildSupportEmp = document.getElementById('input-child-support-emp');
        const inputChildSupportComp = document.getElementById('input-child-support-comp');
        // 協会けんぽ用
        const selectPrefecture = document.getElementById('select-prefecture');
        const inputCustomRate = document.getElementById('input-custom-rate');
        const btnResetRate = document.getElementById('btn-reset-rate');
        // 組合健保用
        const inputKumiaiName = document.getElementById('input-kumiai-name');
        const kHealthEmp = document.getElementById('k-health-emp');
        const kHealthComp = document.getElementById('k-health-comp');
        const kNursingEmp = document.getElementById('k-nursing-emp');
        const kNursingComp = document.getElementById('k-nursing-comp');
        const saveBtn = document.getElementById('btn-save-insurance-master');
        const saveMsg = document.getElementById('save-msg-insurance');
        // 保存処理のどこかに、これを追加して一緒に保存させてください！
        const elPensionNum = document.getElementById('master-pension-number');
        // 保存するオブジェクトに pensionNumber: elPensionNum.value を追加するイメージです。
        // 💡 NEW: ラジオボタンの切り替えアニメーション
        radioInputs.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const target = e.target;
                if (target.value === 'kyokai') {
                    kyokaiSection.style.display = 'block';
                    kumiaiSection.style.display = 'none';
                }
                else {
                    kyokaiSection.style.display = 'none';
                    kumiaiSection.style.display = 'block';
                }
            });
        });
        // 💡 DBのhistoryから「一番新しい設定」を読み込んで表示する
        const loadCurrentSettings = async () => {
            try {
                // 🌟 1. 会社IDを取得して防壁を張る！
                const currentCompanyId = localStorage.getItem('current_company_id');
                if (!currentCompanyId) {
                    console.warn("会社情報が読み込めないため、設定のロードを中止します。");
                    return;
                }
                // 🌟 2. 【超重要】全社共通の 'settings' ではなく、自社専用の 'companies' の中から履歴を読み込む！
                // （※パスを 'companies' -> 自分の会社ID -> 'insurance_history' に変更）
                const historyRef = collection(db, 'companies', currentCompanyId, 'insurance_history');
                const querySnapshot = await getDocs(historyRef);
                let settingsList = [];
                querySnapshot.forEach((doc) => {
                    settingsList.push({ id: doc.id, ...doc.data() });
                });
                if (settingsList.length > 0) {
                    // ID（YYYY-MM）の降順（新しい順）に並び替えて、先頭を取得
                    settingsList.sort((a, b) => b.id.localeCompare(a.id));
                    const latestData = settingsList[0];
                    // 📅 カレンダーに入力されていた適用開始月を復元
                    const applyMonthInput = document.getElementById('input-apply-month');
                    if (applyMonthInput)
                        applyMonthInput.value = latestData.id;
                    // --- 以下は今まで通りの表示復元ロジック ---
                    const insType = latestData.insuranceType || 'kyokai';
                    const targetRadio = document.querySelector(`input[name="ins-type"][value="${insType}"]`);
                    if (targetRadio) {
                        targetRadio.checked = true;
                        targetRadio.dispatchEvent(new Event('change'));
                    }
                    if (insType === 'kyokai') {
                        selectPrefecture.value = latestData.prefecture || '東京都';
                        inputCustomRate.value = ((latestData.healthRate || 0.0998) * 100).toFixed(2);
                    }
                    else {
                        inputKumiaiName.value = latestData.prefecture || '';
                        kHealthEmp.value = ((latestData.healthRateEmp || 0) * 100).toFixed(3);
                        kHealthComp.value = ((latestData.healthRateComp || 0) * 100).toFixed(3);
                        kNursingEmp.value = ((latestData.nursingRateEmp || 0) * 100).toFixed(3);
                        kNursingComp.value = ((latestData.nursingRateComp || 0) * 100).toFixed(3);
                    }
                    // 💡 NEW: 子育て関連の料率を復元（データがなければ初期値を表示）
                    if (inputChildContribution)
                        inputChildContribution.value = ((latestData.childContributionRate || 0.0036) * 100).toFixed(3);
                    if (inputChildSupportEmp)
                        inputChildSupportEmp.value = ((latestData.childSupportRateEmp || 0) * 100).toFixed(3);
                    if (inputChildSupportComp)
                        inputChildSupportComp.value = ((latestData.childSupportRateComp || 0) * 100).toFixed(3);
                }
            }
            catch (e) {
                console.error("設定の読み込みに失敗:", e);
            }
        };
        loadCurrentSettings();
        // 協会けんぽのプルダウン連動
        selectPrefecture.addEventListener('change', () => {
            const selectedPref = selectPrefecture.value;
            const rate = PREFECTURE_HEALTH_RATES[selectedPref];
            if (rate)
                inputCustomRate.value = (rate * 100).toFixed(2);
        });
        btnResetRate.addEventListener('click', () => {
            const rate = PREFECTURE_HEALTH_RATES[selectPrefecture.value];
            if (rate)
                inputCustomRate.value = (rate * 100).toFixed(2);
        });
        // ==========================================
        // 🏢 会社情報のロード（Firebaseメイン、無い場合はLocalから）
        // ==========================================
        //   try {
        //     const docSnap = await getDoc(doc(db, 'settings', 'company'));
        //     if (docSnap.exists()) {
        //         const data = docSnap.data();
        //         (document.getElementById('master-company-name') as HTMLInputElement).value = data.companyName || '';
        //         (document.getElementById('master-employer-name') as HTMLInputElement).value = data.employerName || '';
        //         (document.getElementById('master-zip1') as HTMLInputElement).value = data.zip1 || '';
        //         (document.getElementById('master-zip2') as HTMLInputElement).value = data.zip2 || '';
        //         (document.getElementById('master-address') as HTMLInputElement).value = data.address || '';
        //         (document.getElementById('master-tel1') as HTMLInputElement).value = data.tel1 || '';
        //         (document.getElementById('master-tel2') as HTMLInputElement).value = data.tel2 || '';
        //         (document.getElementById('master-tel3') as HTMLInputElement).value = data.tel3 || '';
        //         (document.getElementById('master-pref-code') as HTMLInputElement).value = data.prefCode || '';
        //         (document.getElementById('master-city-code') as HTMLInputElement).value = data.cityCode || '';
        //         (document.getElementById('master-pension-symbol') as HTMLInputElement).value = data.officeSymbol || '';
        //         (document.getElementById('master-pension-number') as HTMLInputElement).value = data.officeNumber || '';
        //         (document.getElementById('master-emp-ins-number') as HTMLInputElement).value = data.empInsNumber || '';
        //     } else {
        //         // Firebaseにデータが無い（初回）場合は、既存の localStorage から最低限復元する（安全装置）
        //         const savedCompanyMaster = JSON.parse(localStorage.getItem('hr_company_master') || '{}');
        //         (document.getElementById('master-company-name') as HTMLInputElement).value = savedCompanyMaster.companyName || '';
        //         (document.getElementById('master-pension-symbol') as HTMLInputElement).value = savedCompanyMaster.pensionSymbol || '';
        //         (document.getElementById('master-emp-ins-number') as HTMLInputElement).value = savedCompanyMaster.empInsNumber || '';
        //     }
        // } catch (e) {
        //     console.error("会社情報の読み込みエラー:", e);
        // }
        // 💾 保存処理（究極のハイブリッド保存 ＋ バリデーション完備！）
        saveBtn.addEventListener('click', async () => {
            const applyMonthInput = document.getElementById('input-apply-month');
            const applyMonth = applyMonthInput.value;
            // 未入力チェック（月が選ばれていないと保存させない）
            if (!applyMonth) {
                alert('適用開始月を選択してください！');
                return;
            }
            const selectedType = document.querySelector('input[name="ins-type"]:checked').value;
            let saveData = {
                insuranceType: selectedType,
                updatedAt: new Date(),
                pensionRate: 0.1830, // 厚生年金は法律で固定
                childContributionRate: Number(inputChildContribution.value) / 100,
                childSupportRateEmp: Number(inputChildSupportEmp.value) / 100,
                childSupportRateComp: Number(inputChildSupportComp.value) / 100,
                childSupportRate: (Number(inputChildSupportEmp.value) / 100) + (Number(inputChildSupportComp.value) / 100)
            };
            if (selectedType === 'kyokai') {
                // 🚨 協会けんぽ用の入力チェック（竹高さんのご指摘通り復活！）
                if (!selectPrefecture.value || !inputCustomRate.value) {
                    alert('都道府県と料率を正しく入力してください！');
                    return; // ここで処理をストップ
                }
                const totalRate = Number(inputCustomRate.value) / 100;
                saveData.prefecture = selectPrefecture.value;
                saveData.healthRate = totalRate;
                saveData.healthRateEmp = totalRate / 2;
                saveData.healthRateComp = totalRate / 2;
                saveData.nursingRate = 0.0160;
                saveData.nursingRateEmp = 0.0160 / 2;
                saveData.nursingRateComp = 0.0160 / 2;
            }
            else {
                // 🚨 組合健保用の入力チェック（空欄が1つでもあればストップ！）
                if (!inputKumiaiName.value || !kHealthEmp.value || !kHealthComp.value || !kNursingEmp.value || !kNursingComp.value) {
                    alert('組合名と、すべての負担割合を正しく入力してください！');
                    return;
                }
                saveData.prefecture = inputKumiaiName.value; // 組合名を入れる
                saveData.healthRateEmp = Number(kHealthEmp.value) / 100;
                saveData.healthRateComp = Number(kHealthComp.value) / 100;
                saveData.healthRate = saveData.healthRateEmp + saveData.healthRateComp; // 合計も一応持っておく
                saveData.nursingRateEmp = Number(kNursingEmp.value) / 100;
                saveData.nursingRateComp = Number(kNursingComp.value) / 100;
                saveData.nursingRate = saveData.nursingRateEmp + saveData.nursingRateComp;
            }
            try {
                // 💡 NEW: パスを履歴用（history）に変更し、IDに取得した applyMonth を使う！
                // 例：'settings', 'insurance', 'history', '2026-04' に保存される
                // 🌟 1. 会社IDを取得！
                const currentCompanyId = localStorage.getItem('current_company_id');
                if (!currentCompanyId) {
                    alert("会社情報が読み込めません。再読み込みしてください。");
                    return;
                }
                // 🌟 2. 自分の会社専用の箱（パス）に保存する！
                await setDoc(doc(db, 'companies', currentCompanyId, 'insurance_history', applyMonth), saveData);
                saveMsg.style.display = 'inline';
                setTimeout(() => { saveMsg.style.display = 'none'; }, 3000);
            }
            catch (e) {
                console.error('保存エラー:', e);
                alert('設定の保存に失敗しました。');
            }
        });
        // ==========================================
        // 🏢 会社情報の保存（Firebase ＆ LocalStorage のハイブリッド）
        // ==========================================
        const btnSaveNumbers = document.getElementById('btn-save-company-numbers');
        if (btnSaveNumbers) {
            // 🌟 async を追加して Firebase 通信に対応！
            btnSaveNumbers.addEventListener('click', async () => {
                // 1. 画面から値を取得（新設した「事業所名」もここで取得！）
                const companyName = document.getElementById('master-company-name')?.value || '';
                const employerName = document.getElementById('master-employer-name')?.value || '';
                const branchName = document.getElementById('master-branch-name')?.value || '本社'; // 👈 NEW!!
                const zip1 = document.getElementById('master-zip1')?.value || '';
                const zip2 = document.getElementById('master-zip2')?.value || '';
                const address = document.getElementById('master-address')?.value || '';
                const tel1 = document.getElementById('master-tel1')?.value || '';
                const tel2 = document.getElementById('master-tel2')?.value || '';
                const tel3 = document.getElementById('master-tel3')?.value || '';
                const prefCode = document.getElementById('master-pref-code')?.value || '';
                const cityCode = document.getElementById('master-city-code')?.value || '';
                const officeSymbol = document.getElementById('master-pension-symbol')?.value || '';
                const officeNumber = document.getElementById('master-pension-number')?.value || '';
                const empInsNumber = document.getElementById('master-emp-ins-number')?.value || '';
                // 🌟🌟🌟 2. データを「会社」と「事業所」の階層に綺麗に整理する！ 🌟🌟🌟
                const companySettings = {
                    companyName: companyName,
                    employerName: employerName,
                    // 📍 事業所情報を「mainBranch」という箱にまとめる
                    mainBranch: {
                        branchName: branchName,
                        zipCode: `${zip1}-${zip2}`,
                        address: address,
                        tel: `${tel1}-${tel2}-${tel3}`,
                        prefCode: prefCode,
                        cityCode: cityCode,
                        officeSymbol: officeSymbol,
                        officeNumber: officeNumber,
                        empInsNumber: empInsNumber
                    },
                    updatedAt: new Date()
                };
                try {
                    // 3. Firebase に保存
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("エラー：会社IDが取得できませんでした。");
                        return;
                    }
                    // 🌟 Firebaseには、その会社IDのドキュメントに保存する！
                    await setDoc(doc(db, 'companies', currentCompanyId), companySettings, { merge: true });
                    // 🌟 LocalStorage（ブラウザの記憶）も、会社ID付きの【専用の箱】に保存する！
                    // ❌ localStorage.setItem('hr_company_master', ...); ← これはもう使いません！
                    localStorage.setItem(`company_master_${currentCompanyId}`, JSON.stringify(companySettings));
                    // 5. 保存完了メッセージの表示
                    const msg = document.getElementById('save-msg-numbers');
                    if (msg) {
                        msg.style.display = 'inline-block';
                        setTimeout(() => { msg.style.display = 'none'; }, 3000);
                    }
                }
                catch (e) {
                    console.error("会社情報の保存エラー:", e);
                    alert('設定の保存に失敗しました。');
                }
            });
        }
    }
    catch (error) {
        console.error('マスターHTML読み込みエラー:', error);
    }
}
// ② 見つけていただいた切り替えロジックを、タイミングを合わせて実行する関数に包む
function initSubTabEvents() {
    const subTabButtons = document.querySelectorAll('.sub-tab-btn');
    subTabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            // 全てのサブタブボタンをグレーにリセット
            document.querySelectorAll('.sub-tab-btn').forEach(btn => {
                const b = btn;
                b.style.background = '#f8f9fa';
                b.style.color = '#555';
                b.style.border = '1px solid #ddd';
                b.classList.remove('active');
            });
            // 押されたボタンだけ青くする
            const clickedBtn = e.currentTarget;
            clickedBtn.style.background = '#0056b3';
            clickedBtn.style.color = 'white';
            clickedBtn.style.border = 'none';
            clickedBtn.classList.add('active');
            // 全ての中身を非表示にする
            document.querySelectorAll('.sub-tab-content').forEach(content => {
                content.style.display = 'none';
            });
            // 対象のコンテンツだけを表示する
            const targetId = clickedBtn.getAttribute('data-sub-target');
            if (targetId) {
                const targetContent = document.getElementById(targetId);
                localStorage.setItem('lastActiveSubTab', targetId);
                if (targetContent)
                    targetContent.style.display = 'block';
                // 🌟 NEW: もし押されたタブが「随時改定（payroll-zuiji）」なら、表を作る関数を動かす！
                if (targetId === 'payroll-monthly') {
                    initMonthlySalaryUI();
                }
                else if (targetId === 'payroll-zuiji') {
                    initZuijiUI();
                }
                else if (targetId === 'payroll-santei') {
                    initSanteiUI();
                }
                else if (targetId === 'payroll-bonus') {
                    initBonusUI();
                }
            }
        });
    });
    // 🌟 追加2：関数の一番下（ループの外）で、記憶していたサブタブを自動クリックする！
    setTimeout(() => {
        const savedSubTab = localStorage.getItem('lastActiveSubTab') || 'payroll-monthly';
        const tabToClick = document.querySelector(`[data-sub-target="${savedSubTab}"]`);
        if (tabToClick) {
            tabToClick.click();
        }
    }, 100);
}
// ③ アプリ起動時に、自動で給与タブをドッキングする
// ☺️ アプリ起動時に、自動で給与タブをドッキングする（メイン初期化処理）
window.addEventListener('DOMContentLoaded', async () => {
    // 🌟 1. プルダウン生成を最優先で行う！
    const targetSelect = document.getElementById('zuiji-target-month');
    if (targetSelect) {
        targetSelect.innerHTML = '';
        const now = new Date();
        const currentY = now.getFullYear();
        const currentM = now.getMonth() + 1;
        for (let i = -1; i <= 5; i++) {
            let y = currentY;
            let m = currentM + i;
            if (m > 12) {
                m -= 12;
                y += 1;
            }
            if (m <= 0) {
                m += 12;
                y -= 1;
            }
            const option = document.createElement('option');
            option.value = String(m); // 6, 7, 8...
            option.text = `${y}年 ${m}月 改定予定`;
            if (i === 1)
                option.selected = true;
            targetSelect.appendChild(option);
        }
        // 👇＝＝＝＝＝＝ ここから追加！ ＝＝＝＝＝＝👇
        // プルダウンが変更されたら、随時改定の判定を「やり直す」！
        targetSelect.addEventListener('change', () => {
            console.log(`プルダウンが ${targetSelect.value}月 に変更されました！再計算します！`);
            // 画面のリストを一度カラにする（残像を消す）
            const listBody = document.getElementById('zuiji-list-body'); // ※IDは実際のtbodyのIDに合わせてください
            if (listBody)
                listBody.innerHTML = '';
            // 🌟 ここで「随時改定の判定をして画面に表示するメイン関数」をもう一度呼び出す！
            // 例: loadZuijiData(); や checkZuijiKaitei(); など
        });
        // ☝＝＝＝＝＝＝ ここまで追加！ ＝＝＝＝＝＝☝
    }
    // 🌟 2. 既存の読み込み処理（これはプルダウンができた後に呼ぶ！）
    loadSalaryTab();
    loadEmployeeListTab();
    loadInsuranceMasterTab();
    loadLifeEventTab();
    await checkAndCreateSanteiTask();
    // 🌟 3. ここで「随時改定タブ」の初期表示用イベントを発火させる
    // 画面が開いたときに一度計算させる
    initZuijiUI();
});
// ==========================================
// 🚪 退職タスク完了時のマスタ自動更新エンジン
// ==========================================
export async function checkAndProcessRetirementTask(task) {
    // タスクが「資格喪失届」で、かつステータスが「done（完了）」になった時だけ発動
    if (task.status === 'done' && task.title && task.title.includes('被保険者資格喪失届')) {
        try {
            let targetDocId = task.empId || task.userId;
            // 🌟 安全装置：タスクにIDがない場合、名前からマスタのIDを「自社内から」逆引きする
            if (!targetDocId && task.empName) {
                // 🌟 1. 会社IDを取得して防壁を張る！
                const currentCompanyId = localStorage.getItem('current_company_id');
                if (!currentCompanyId) {
                    console.error("会社IDが取得できないため、自動退職処理をスキップしました。");
                    return;
                }
                // 🌟 2. 【超重要】「自社」の従業員だけを絞り込んで名前を検索！！！
                const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                const usersSnap = await getDocs(usersQuery);
                usersSnap.forEach(u => {
                    const d = u.data();
                    const fullName = `${d.lastNameKanji || ''} ${d.firstNameKanji || ''}`.trim();
                    if (fullName === task.empName)
                        targetDocId = u.id;
                });
            }
            if (targetDocId) {
                // Firestoreの従業員マスタを「退職済」に更新！
                await updateDoc(doc(db, 'users', targetDocId), {
                    employeeStatus: 'retired', // 先ほどタブ分けで使ったステータス
                    resignationDate: task.deadline || new Date().toISOString().split('T')[0]
                });
                console.log(`✅ 従業員マスタを「退職済」に更新しました（ID: ${targetDocId}）`);
                // 完了メッセージ（少し遅らせて表示すると画面の動きと合って綺麗です）
                setTimeout(() => {
                    alert(`🚪 ${task.empName} さんの資格喪失タスクが完了したため、\n従業員マスタを「退職済」に自動更新しました。`);
                }, 500);
            }
        }
        catch (error) {
            console.error("退職済ステータス更新エラー:", error);
        }
    }
}
// ==========================================
// 💡 月額給与タブ（毎月の実績入力）の制御ロジック
// ==========================================
// // 1. firebaseから従業員を読み込む
// async function fetchEmployeesFromFirebase() {
//     const querySnapshot = await getDocs(collection(db, "employees"));
//     const employees: any[] = [];
//     querySnapshot.forEach((doc) => {
//       // Firebase上のドキュメントIDまたはフィールドの「employeeId」を使う
//       employees.push({ id: doc.id, ...doc.data() });
//     });
//     return employees;
//   }
// ==========================================
// 🌟 随時改定の統合ロジック（どこからでも呼べる共通関数）
// ==========================================
function getZuijiTargets(revisionYear, revisionMonth, employees, payrollRecords) {
    let endMonth = revisionMonth - 1;
    let endYear = revisionYear;
    if (endMonth === 0) {
        endMonth = 12;
        endYear -= 1;
    }
    const targets = [];
    employees.forEach((emp) => {
        const targetEmpId = String(emp.employeeId || emp.employeeNumber || emp.id);
        const empName = (emp.lastNameKanji || emp.firstNameKanji) ? `${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''}`.trim() : "名称未設定";
        const empHistory = payrollRecords
            .filter(r => String(r.employeeId) === targetEmpId)
            .filter(r => Number(r.year) < endYear || (Number(r.year) === endYear && Number(r.month) <= endMonth))
            .sort((a, b) => {
            if (Number(a.year) !== Number(b.year))
                return Number(a.year) - Number(b.year);
            return Number(a.month) - Number(b.month);
        });
        if (empHistory.length >= 3) {
            const last3Months = empHistory.slice(-3);
            const m1 = last3Months[0]; // 変動月
            const m2 = last3Months[1];
            const m3 = last3Months[2];
            const m0 = empHistory[empHistory.length - 4]; // 比較用の前月
            // 👇＝＝＝＝＝＝ ここから追加！ ＝＝＝＝＝＝👇
            // 🌟 厳密チェック：「持ってきた最新の記録（m3）」が、本当に「改定予定月の前月（endMonth）」か？
            if (Number(m3.year) !== endYear || Number(m3.month) !== endMonth) {
                // 違うなら、まだ必要な月の実績が保存されていない（未来の月を選んでいる）ためスキップ！
                return;
            }
            // ☝＝＝＝＝＝＝ ここまで追加！ ＝＝＝＝＝＝☝
            // 月額給与で登録された調整フラグ、または固定給の変化
            const isSokyu = m1.adjustmentReason === "sokyu";
            const isFixedWageChanged = m0 && (Number(m1.fixedWage) !== Number(m0.fixedWage));
            if (isSokyu || isFixedWageChanged) {
                // 👇＝＝＝＝＝＝ 古い threshold のコードを消して、ここに差し替え！ ＝＝＝＝＝＝👇
                // =========================================================
                // 🌟🌟🌟 随時改定 ハイブリッド判定（しきい値の決定） 🌟🌟🌟
                // =========================================================
                const socInsType = emp.socialInsuranceType || 'regular';
                let threshold = 17; // 🏢 基本は17日（一般社員・パート共通！）
                if (socInsType === 'short_time') {
                    threshold = 11; // ⏱️ 短時間労働者のときだけ11日基準に下げる！
                }
                // =========================================================
                // ☝＝＝＝＝＝＝ ここまで ＝＝＝＝＝＝☝
                if (Number(m1.days) >= threshold && Number(m2.days) >= threshold && Number(m3.days) >= threshold) {
                    const w1 = Number(m1.totalWage || 0) - Number(m1.adjustmentAmount || 0);
                    const w2 = Number(m2.totalWage || 0) - Number(m2.adjustmentAmount || 0);
                    const w3 = Number(m3.totalWage || 0) - Number(m3.adjustmentAmount || 0);
                    const avgWage = Math.floor((w1 + w2 + w3) / 3);
                    const newInsurance = calculateSocialInsurance(avgWage);
                    const newGrade = newInsurance.healthGrade;
                    const currentGrade = Number(emp.healthGrade || 1);
                    const gradeDiff = Math.abs(newGrade - currentGrade);
                    if (gradeDiff >= 2) {
                        targets.push({
                            id: targetEmpId,
                            name: empName,
                            m1, m2, m3,
                            avgWage, currentGrade, newGrade, gradeDiff,
                            triggerText: isSokyu ? "遡及適用（ベースUP等）" : "固定的賃金（基本給等）の変動"
                        });
                    }
                }
            }
        }
    });
    return targets;
}
// ==========================================
// 💡 月額給与タブ（毎月の実績入力）の制御ロジック（Firebase実データ連動版）
// ==========================================
async function initMonthlySalaryUI() {
    // 💡 1. 従業員のループを回す「前」に、会社設定の料率をDBから1回だけ取得する！
    const tbody = document.getElementById('salary-input-body');
    if (!tbody)
        return;
    // 🌟 パソコンの時計から「今」の年月を自動取得する！
    // ブラウザの記憶を探して、あれば数値に変換。なければ 2026 / 6 を初期値にする！
    let currentYear = Number(localStorage.getItem('saved_salary_year')) || 2026;
    let currentMonth = Number(localStorage.getItem('saved_salary_month')) || 6;
    // 🔄 画面を描画する関数（月を切り替えるたびに呼ばれる！）
    const loadMonthlyData = async () => {
        const alertBox = document.getElementById('monthly-change-alert');
        if (alertBox)
            alertBox.style.display = 'none';
        // 🌟 ここに期間更新処理をドッキング！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (currentCompanyId) {
            const companySnap = await getDoc(doc(db, 'companies', currentCompanyId));
            const data = companySnap.exists() ? companySnap.data() : {};
            // 設定値を取得（なければデフォルト）
            const cDay = data.cutoffDay || "末";
            const pMonth = data.paymentMonth || "next";
            // 期間計算ロジック（そのままコピーして使ってください！）
            let s = "", e = "";
            if (cDay === "末" || cDay === "末日") {
                if (pMonth === "current" || pMonth === "当月払い") {
                    s = `${currentMonth}月1日`;
                    e = `${currentMonth}月末日`;
                }
                else {
                    const d = new Date(currentYear, currentMonth - 2, 1);
                    s = `${d.getMonth() + 1}月1日`;
                    e = `${d.getMonth() + 1}月末日`;
                }
            }
            else {
                const c = parseInt(cDay, 10);
                if (pMonth === "current" || pMonth === "当月払い") {
                    const d = new Date(currentYear, currentMonth - 2, 1);
                    s = `${d.getMonth() + 1}月${c + 1}日`;
                    e = `${currentMonth}月${c}日`;
                }
                else {
                    const d1 = new Date(currentYear, currentMonth - 3, 1);
                    const d2 = new Date(currentYear, currentMonth - 2, 1);
                    s = `${d1.getMonth() + 1}月${c + 1}日`;
                    e = `${d2.getMonth() + 1}月${c}日`;
                }
            }
            const guide = document.getElementById('salary-period-guide') || document.getElementById('display-target-period');
            if (guide)
                guide.innerText = `（${s} 〜 ${e} 稼働分）`;
        }
        const companyRates = await fetchCompanyInsuranceSettings(currentYear, currentMonth);
        const display = document.getElementById('display-current-month');
        if (display)
            display.innerText = `${currentYear}年 ${currentMonth}月分 給与実績`;
        const tbody = document.getElementById('salary-input-body');
        if (!tbody)
            return;
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px;">🔄 ${currentMonth}月のデータを読み込み中...</td></tr>`;
        try {
            // 🌟 先頭で2つの配列を綺麗に準備しておく！
            const employees = [];
            const payrollRecords = []; // ① ここで宣言しているのでOK！
            // ==========================================
            // 🌟 NEW: 会社IDを取得して魔法のフィルターをかける！
            // ==========================================
            const currentCompanyId = localStorage.getItem('current_company_id');
            if (!currentCompanyId) {
                console.error("会社IDが見つかりません");
                return;
            }
            // 🌟 修正①：従業員を「自分の会社」だけで絞り込む！
            const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
            const usersSnapshot = await getDocs(usersQuery);
            const currentFilter = localStorage.getItem('salary_status') || 'active';
            const currentTypeFilter = localStorage.getItem('salary_type') || 'all';
            // 🌟🌟🌟 ここからテストコードを追加！ 🌟🌟🌟
            console.log("🚨 【テスト】給与タブの読み込みスタート 🚨");
            console.log("① 今のフィルター状態 -> ステータス:", currentFilter, " / 区分:", currentTypeFilter);
            // 🌟🌟🌟 ここまで 🌟🌟🌟
            usersSnapshot.forEach((doc) => {
                const data = doc.data();
                if (currentFilter === 'active' && data.employeeStatus !== 'active')
                    return;
                if (currentFilter === 'retired' && data.employeeStatus !== 'retired')
                    return;
                // ...（この間の socInsType などのフィルター処理はそのまま変更なし！）...
                // =========================================================
                // 🌟🌟🌟 2. 【NEW】区分（社保区分）のフィルター 🌟🌟🌟
                // =========================================================
                // 💡 過去のテストデータ（山田13など）には socialInsuranceType が保存されていないので、
                //    空っぽの場合はデフォルトで 'regular'（一般・17日基準）として扱う！
                const socInsType = data.socialInsuranceType || 'regular';
                if (currentTypeFilter !== 'all') {
                    // 画面のプルダウンの値（regular, part_time, short_time）と一致しない人は弾く！
                    if (socInsType !== currentTypeFilter)
                        return;
                }
                // =========================================================
                // =========================================================
                // 🌟🌟🌟 【ここに追加！】入社月より前の画面なら弾く処理 🌟🌟🌟
                // =========================================================
                // 画像のデータベース構造に合わせて、contractInfo の中の startDate を取得！
                const joinDateStr = data.contractInfo?.startDate;
                if (joinDateStr) {
                    const joinDateObj = new Date(joinDateStr);
                    const joinYear = joinDateObj.getFullYear();
                    const joinMonth = joinDateObj.getMonth() + 1;
                    // 画面の年月（currentYear, currentMonth）が、入社年月より「過去」なら配列に入れない（スキップ）！
                    if (currentYear < joinYear || (currentYear === joinYear && currentMonth < joinMonth)) {
                        return;
                    }
                }
                // =========================================================
                employees.push({ id: doc.id, ...data });
            });
            // 社員番号順に並び替え
            employees.sort((a, b) => {
                const idA = a.employeeId || "";
                const idB = b.employeeId || "";
                if (idA < idB)
                    return -1;
                if (idA > idB)
                    return 1;
                return 0;
            });
            // 💡 ここで「該当月の給与データ」をFirebaseから取ってくる！
            // 🌟 修正②：給与データも「自分の会社」のものだけで絞り込む！
            const payrollQuery = query(collection(db, "monthly_payroll_records"), where("companyId", "==", currentCompanyId));
            const payrollSnapshot = await getDocs(payrollQuery);
            // ❌ ここにあった「const payrollRecords: any[] = [];」の1行を消去！！
            // 先頭で宣言した配列に、そのまま push して詰め込んでいきます
            payrollSnapshot.forEach((doc) => payrollRecords.push(doc.data()));
            tbody.innerHTML = '';
            if (employees.length === 0)
                return;
            // ==========================================
            // 🐉 ラスボス：遡及徴収のための「前月データ」準備
            // ==========================================
            let prevMonth = currentMonth - 1;
            let prevYear = currentYear;
            if (prevMonth === 0) {
                prevMonth = 12;
                prevYear -= 1;
            }
            // 🔮 タイムトラベル！「前月の正しい料率設定」を履歴から引っ張ってくる
            let prevCompanyRates = await fetchCompanyInsuranceSettings(prevYear, prevMonth);
            // ==========================================
            // =========================================================
            // 🌟🌟🌟 【ここに追加！】前月マスタが空っぽの時に「0円」になるのを防ぐ防波堤 🌟🌟🌟
            // =========================================================
            if (!prevCompanyRates || Object.keys(prevCompanyRates).length === 0 || !prevCompanyRates.healthRateEmp) {
                console.log(`⚠️ ${prevMonth}月のマスタが無いため、今月の料率で代用します！`);
                prevCompanyRates = companyRates;
            }
            // =========================================================
            // 🌟 防波堤1：万が一配列に同じ人が混ざっていても、IDで一意にまとめる（ダブり消去）
            const uniqueEmployees = Array.from(new Map(employees.map(e => [e.id, e])).values());
            // 🌟 防波堤2：HTMLを描画する直前に、もう一度テーブルを絶対に空っぽにする！
            const currentTbody = document.getElementById('salary-input-body');
            if (currentTbody)
                currentTbody.innerHTML = '';
            // 🌟 修正：ループを回す配列を employees から uniqueEmployees に変更！
            uniqueEmployees.forEach((emp, index) => {
                const lastName = emp.lastNameKanji || "";
                const firstName = emp.firstNameKanji || "";
                const empName = (lastName || firstName) ? `${lastName} ${firstName}`.trim() : "名称未設定";
                const empId = emp.employeeId || emp.employeeNumber || emp.id;
                const empType = emp.contractInfo?.empType || "未設定";
                // 🌟 修正1：後で上書きできるように「const」から「let」に変更！
                let hGrade = emp.healthGrade || 1;
                let pGrade = emp.pensionGrade || 1;
                // 🌟🌟🌟 【タイムマシン変身ロジックを追加！】 🌟🌟🌟
                // もし「算定の予約チケット」を持っていて、かつ今開いている画面が「2026年9月以降」なら…
                if (emp.santeiNextHealthGrade && (currentYear > 2026 || (currentYear === 2026 && currentMonth >= 9))) {
                    hGrade = Number(emp.santeiNextHealthGrade); // 予約されていた新等級にすり替え！
                    pGrade = Number(emp.santeiNextPensionGrade);
                }
                // 🌟🌟🌟 【タイムマシンここまで】 🌟🌟🌟
                const bHealth = emp.baseHealth || 0;
                const bPension = emp.basePension || 0;
                // 💡 1. 従業員の年齢を計算する（今開いている給与の月基準）
                // ※ currentYear と currentMonth は、給与画面の上部で選んでいる年・月です
                const empAge = calculateAgeForPayroll(emp.birthdate, currentYear, currentMonth);
                // 💡 2. 計算エンジンを呼び出して、3つの保険料を全自動で出してもらう！
                // ※ 第1引数: 計算のベースとなる金額 (ここでは一旦 bHealth を渡します)
                // ※ 第2引数: 計算した年齢
                // 🌟 第4引数にマスタの等級（hGrade）を渡すことで、エンジンがマスタ優先モードで発動します！
                const socialInsurance = calculateSocialInsurance(bHealth, empAge, companyRates, hGrade);
                // 💡 読み込んだデータの中から、この人・この年の・この月のデータを探す！
                const record = payrollRecords.find(r => r.employeeId === empId && r.year === currentYear && r.month === currentMonth);
                const isExempt = emp.isSocialInsuranceExempt === true;
                // 💡 変更後（DBに record.healthPremium などがあればそれを採用する！）
                let currentHealthPremium = record && record.healthPremium !== undefined ? record.healthPremium : socialInsurance.healthPremium;
                let currentPensionPremium = record && record.pensionPremium !== undefined ? record.pensionPremium : socialInsurance.pensionPremium;
                let currentNursingPremium = record && record.nursingPremium !== undefined ? record.nursingPremium : socialInsurance.nursingPremium;
                // 💡 4. 会社負担額の合計にも介護保険を足す
                // 💡 エンジンが計算してくれた「会社負担分（Comp）」を足すだけ！
                let companyBurden = socialInsurance.healthPremiumComp + socialInsurance.nursingPremiumComp + socialInsurance.pensionPremiumComp;
                // ==========================================
                // 💡 NEW: 子育て関連の計算をここに追加！
                // ==========================================
                // ① 子ども・子育て支援金（エンジンが正しく等級ベースで計算してくれた結果を受け取る！）
                let childSupportEmp = record && record.childSupportEmp !== undefined
                    ? record.childSupportEmp
                    : (socialInsurance.childSupportPremium || 0);
                // 🌟 ここからデバッグ用のトラップをコピペ！
                if (empId === "000018" || empName.includes("山田10")) { // 山田10さんだけを狙い撃ち
                    console.log(`=== 🕵️‍♂️ 山田10さんの子育て支援金デバッグ ===`);
                    console.log(`① マスタから渡された料率 (companyRates.childSupportRateEmp):`, companyRates.childSupportRateEmp);
                    console.log(`② エンジンが計算した結果 (socialInsurance.childSupportPremium):`, socialInsurance.childSupportPremium);
                    console.log(`③ Firebaseの過去データ (record?.childSupportEmp):`, record ? record.childSupportEmp : "過去データなし");
                    console.log(`④ 最終的に採用された金額 (childSupportEmp):`, childSupportEmp);
                    console.log(`=======================================`);
                }
                let childSupportComp = socialInsurance.childSupportPremiumComp || 0;
                // ② 子ども・子育て拠出金（全額会社負担 / ここは厚年ベースなので、エンジンのstandardPensionを使います！）
                let childContribution = Math.round((socialInsurance.standardPension || 0) * (companyRates.childContributionRate || 0));
                let exemptBadgeHTML = "";
                if (isExempt) {
                    if (record) {
                        // 💡 過去に保存されたレコードがある場合は、当時の金額をそのまま表示（0円上書きをスキップ）
                        exemptBadgeHTML = `<span style="background:#6c757d; color:white; font-size:9px; padding:2px 6px; border-radius:4px;">免除(過去)</span>`;
                    }
                    else {
                        // 💡 まだデータがない（これから計算して保存する）月だけ、強制的に0円にする
                        currentHealthPremium = 0;
                        currentPensionPremium = 0;
                        currentNursingPremium = 0;
                        companyBurden = 0;
                        childSupportEmp = 0;
                        childSupportComp = 0;
                        childContribution = 0;
                        exemptBadgeHTML = `<div style="display:inline-block; background:#28a745; color:white; font-size:10px; padding:2px 6px; border-radius:4px; margin-bottom:4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">🆓 育休免除適用中</div>`;
                    }
                }
                // 💡 会社負担の総合計を計算
                // ※ すでにあるかもしれない let companyBurden = ... の行を探して、以下のように子育て支援金たちを足しこんでください。
                // 🌟🌟🌟 ここから追加：会社負担の免除フィルター 🌟🌟🌟
                // 💡 isExempt（免除フラグ）がONなら強制的に0円にする！
                const healthComp = isExempt ? 0 : (socialInsurance?.healthPremiumComp || 0);
                const nursingComp = isExempt ? 0 : (socialInsurance?.nursingPremiumComp || 0);
                const pensionComp = isExempt ? 0 : (socialInsurance?.pensionPremiumComp || 0);
                const safeChildSupport = isExempt ? 0 : (childSupportComp || 0);
                const safeChildContrib = isExempt ? 0 : (childContribution || 0);
                // 💡 免除フィルターを通ったあとのキレイな変数で、改めて総合計を計算する
                let totalCompanyBurden = healthComp + nursingComp + pensionComp + safeChildSupport + safeChildContrib;
                // 前月の「実際に天引きした実績データ」を探す
                const prevRecord = payrollRecords.find(r => r.employeeId === empId && r.year === prevYear && r.month === prevMonth);
                // 差額を入れる箱
                // 💡 すべての保険料の差額を入れる箱を用意
                let retroHealthDiff = 0;
                let retroNursingDiff = 0;
                let retroPensionDiff = 0;
                let retroChildDiff = 0;
                // 💡 これが抜けていました！警告バッジを入れるための「空の箱」をここで準備します
                let retroAlertHTML = '';
                if (prevRecord && (!record || !record.retroApplied)) {
                    // 前月（5月）時点での年齢を正確に計算する
                    const prevEmpAge = calculateAgeForPayroll(emp.birthdate, prevYear, prevMonth);
                    // エンジンに「前月の料率」と「前月の年齢」を渡して正解を出させる
                    const prevCorrectCalc = calculateSocialInsurance(bHealth, prevEmpAge, prevCompanyRates, hGrade);
                    // 🌟 育休中（免除）かどうかを判定
                    const isExempt = emp.isSocialInsuranceExempt === true;
                    // 1. 健保の差額
                    const actualHealth = prevRecord.healthPremium || 0;
                    const correctHealth = isExempt ? 0 : prevCorrectCalc.healthPremium;
                    retroHealthDiff = correctHealth - actualHealth;
                    // 2. 介護の差額
                    const actualNursing = prevRecord.nursingPremium || 0;
                    const correctNursing = isExempt ? 0 : prevCorrectCalc.nursingPremium;
                    retroNursingDiff = correctNursing - actualNursing;
                    // 3. 厚年の差額
                    const actualPension = prevRecord.pensionPremium || 0;
                    const correctPension = isExempt ? 0 : prevCorrectCalc.pensionPremium;
                    retroPensionDiff = correctPension - actualPension;
                    // 4. 子育て支援金（従業員負担はそもそも0円なので差額は絶対に発生しない！）
                    retroChildDiff = 0;
                    // =========================================================
                    // 🛡️ 遡及ガード・コンソール実験版！！！
                    // =========================================================
                    const cRates = companyRates;
                    const pRates = prevCompanyRates;
                    const isRateChanged = (cRates.healthRate !== pRates.healthRate) ||
                        (cRates.nursingRate !== pRates.nursingRate);
                    // 👇 ここからコンソール出力実験！
                    console.log(`=== 🕵️‍♂️ 遡及ガード デバッグ: ${empName} ===`);
                    console.log(`今の健保料率(cRates.healthRate):`, cRates.healthRate, `(型: ${typeof cRates.healthRate})`);
                    console.log(`前の健保料率(pRates.healthRate):`, pRates.healthRate, `(型: ${typeof pRates.healthRate})`);
                    console.log(`isRateChanged の判定結果:`, isRateChanged);
                    if (!isRateChanged) {
                        retroHealthDiff = 0;
                        retroNursingDiff = 0;
                        retroPensionDiff = 0;
                        console.log(`✅ ガード発動成功！差額を強制リセットしました。`);
                    }
                    else {
                        console.log(`❌ ガードすり抜け！料率が違うと判定されています！`);
                    }
                    console.log(`====================================`);
                    // 👇＝＝＝ここから下は竹高さんの元のコードそのまま！＝＝＝👇
                    // 💡 さらに防波堤：10円未満の端数ズレは「計算誤差」として無視する（バッジを出さない）
                    if (Math.abs(retroHealthDiff) < 10)
                        retroHealthDiff = 0;
                    if (Math.abs(retroNursingDiff) < 10)
                        retroNursingDiff = 0;
                    if (Math.abs(retroPensionDiff) < 10)
                        retroPensionDiff = 0;
                    // 💡 どこか一つでも差額があればアラートを出す！（子育ては0なので条件から外す）
                    if (retroHealthDiff !== 0 || retroNursingDiff !== 0 || retroPensionDiff !== 0) {
                        // アラートに表示するテキストを動的に作る
                        let diffTexts = [];
                        if (retroHealthDiff !== 0)
                            diffTexts.push(`健保: <span style="color:#d32f2f;">${retroHealthDiff > 0 ? '+' : ''}${retroHealthDiff.toLocaleString()}円</span>`);
                        if (retroNursingDiff !== 0)
                            diffTexts.push(`介護: <span style="color:#d32f2f;">${retroNursingDiff > 0 ? '+' : ''}${retroNursingDiff.toLocaleString()}円</span>`);
                        if (retroPensionDiff !== 0)
                            diffTexts.push(`厚年: <span style="color:#d32f2f;">${retroPensionDiff > 0 ? '+' : ''}${retroPensionDiff.toLocaleString()}円</span>`);
                        retroAlertHTML = `
                <div style="background: #fff3cd; color: #856404; padding: 6px; margin-top: 10px; border-radius: 4px; font-size: 11px; font-weight: bold; border: 1px solid #ffeeba; display: inline-block; line-height: 1.4;">
                  ⚠️ 遡及徴収（前月差額）<br>
                  ${diffTexts.join('<br>')}
                  <br>
                  <button class="btn-apply-retro" style="margin-top:6px; padding:2px 8px; font-size:10px; cursor:pointer; background:#d32f2f; color:#fff; border:none; border-radius:3px;">今月に合算する</button>
                </div>
              `;
                    }
                }
                // データがあればその数値を、なければ初期値を入れる
                // データがあればその数値を、なければ初期値を入れる
                const savedDays = record ? record.days : 30;
                // =========================================================
                // 🌟 過去月ブロック（スナップショット）読み込みロジック
                // 保存データ(record)に当時の基本給・手当があればそれを最優先、なければ最新マスタ(emp)を使う！
                // =========================================================
                const masterBase = (record && record.baseSalary !== undefined) ? record.baseSalary : (emp.baseHealth || 0);
                const masterRole = (record && record.allowanceRole !== undefined) ? record.allowanceRole : (emp.allowances?.role || 0);
                const masterFamily = (record && record.allowanceFamily !== undefined) ? record.allowanceFamily : (emp.allowances?.family || 0);
                const masterHousing = (record && record.allowanceHousing !== undefined) ? record.allowanceHousing : (emp.allowances?.housing || 0);
                const masterFixedOt = (record && record.allowanceFixedOt !== undefined) ? record.allowanceFixedOt : (emp.allowances?.fixedOt || 0);
                const masterCommute = (record && record.allowanceCommute !== undefined) ? record.allowanceCommute : (emp.allowances?.commute || 0);
                // 🌟 表示用の「固定賃金合計」を計算する
                const masterTotalFixed = masterBase + masterRole + masterFamily + masterHousing + masterFixedOt + masterCommute;
                // （旧 savedFixed は masterTotalFixed に統合したため不要になりました）
                const savedNonFixed = record ? record.nonFixedWage : 0;
                // 1. Firebaseから読み込んできたデータ（record）から、調整額と理由を引っ張ってくる
                const savedAdjAmount = record && record.adjustmentAmount ? record.adjustmentAmount : "";
                const savedAdjReason = record && record.adjustmentReason ? record.adjustmentReason : "";
                // 2. リロードした時に、画面の「総支給額」の欄に表示するための初期合計金額を計算する（★ここで5,000円を足す！）
                const initialTotal = Number(masterTotalFixed) + Number(savedNonFixed) + Number(savedAdjAmount);
                const tr = document.createElement('tr');
                tr.setAttribute('data-emp-id', empId);
                // savedAdjReason（データベースから読み込んだ理由）をもとに分岐
                // ❌ ここにあった adjBadgeHTML = ""; などの3行は「削除」してください！
                let adjBadgeHTML = "";
                // savedAdjReason（データベースから読み込んだ理由）をもとに分岐
                // savedAdjReason（データベースから読み込んだ理由）をもとに分岐
                if (savedAdjReason) {
                    if (savedAdjReason === 'sokyu') {
                        const sign = Number(savedAdjAmount) > 0 ? "+" : "";
                        adjBadgeHTML += `<br><span style="font-size: 10px; color: #dc3545;">(遡及適用済み ${sign}${Number(savedAdjAmount).toLocaleString()}円)</span>`;
                    }
                    else if (savedAdjReason === 'chihai_past') {
                        const sign = Number(savedAdjAmount) > 0 ? "+" : "";
                        adjBadgeHTML += `<br><span style="font-size: 10px; color: #0056b3;">(過去の遅配分 ${sign}${Number(savedAdjAmount).toLocaleString()}円)</span>`;
                    }
                    else if (savedAdjReason === 'miharai_now') {
                        // 1. 名前の横にオレンジバッジ
                        exemptBadgeHTML += `<span style="padding: 2px 4px; background: #ff9800; color: white; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 4px;">⚠️ 未払い(算定除外)</span>`;
                        // 🌟 2. 【追加】総支給額の下にもオレンジの文字を出現させる！
                        adjBadgeHTML += `<br><span style="font-size: 10px; color: #ff9800;">(当月分 未払い・遅配あり)</span>`;
                    }
                    else if (savedAdjReason === 'kyushoku') {
                        // 1. 名前の横に赤バッジ
                        exemptBadgeHTML += `<span style="padding: 2px 4px; background: #dc3545; color: white; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 4px;">🚨 休職等(算定除外)</span>`;
                        // 🌟 2. 【追加】総支給額の下にも赤の文字を出現させる！
                        adjBadgeHTML += `<br><span style="font-size: 10px; color: #dc3545;">(休職・一時帰休期間)</span>`;
                    }
                }
                // 💡 2. 会社負担の内訳をまとめたテキストを作る
                // ※もし empName でエラーが出たら、 emp.name や t.name などお使いの名前に変えてください
                // 💡 1. 会社負担専用の変数をリスト化してテキストを作る
                // 💡 1. 改行を「\\n」にするだけ！
                const companyBreakdownText = `【会社負担内訳】\\n`
                    + `健康保険: ${healthComp.toLocaleString()}円\\n`
                    + `介護保険: ${nursingComp.toLocaleString()}円\\n`
                    + `厚生年金: ${pensionComp.toLocaleString()}円\\n`
                    + `子ども・子育て支援金: ${safeChildSupport.toLocaleString()}円\\n`
                    + `子ども・子育て拠出金: ${safeChildContrib.toLocaleString()}円\\n`
                    + `------------------------\\n`
                    + `合計: ${totalCompanyBurden.toLocaleString()}円`;
                // 💡 🔍ポップアップのHTMLを作る
                const burdenHTML = `
  <div style="text-align: right; color: #888; font-size: 10px; margin-top: 2px; cursor: pointer;" 
       onclick="alert('${companyBreakdownText}')">
      (会社負担計: ${totalCompanyBurden.toLocaleString()}円) 🔍
  </div>
`;
                // 💡 1. ポップアップ用の「表示用変数」を作る！
                // 保存データ(record)に当時の基本給があればそれを、なければ最新のマスタ(emp)を使う
                // 🌟 1. 保存データ(record)を完全に無視して、「常に最新のマスタ(emp)」から金額を取得する！
                // 💡 2. 🔍ポップアップの中身を「emp...」から、↑で作った「display...」に書き換える！
                // （tr.innerHTML の中にある固定賃金の 🔍 の部分です）
                // 🌟 ここにこの1行を追加！！！（行に社員IDの名札をつける）
                tr.setAttribute('data-emp-id', String(empId));
                // ==========================================
                // 🌟 UI改善：社保区分のバッジ作成ロジック（追加！）
                // ※ empType は竹高さんが上で既に定義しているのでそのまま使います！
                // ==========================================
                let socInsLabel = "一般";
                let socInsBg = "#d1fae5"; // 背景：薄い緑
                let socInsText = "#065f46"; // 文字：濃い緑
                if (emp.socialInsuranceType === "short_time") {
                    socInsLabel = "短時間";
                    socInsBg = "#fef08a"; // 背景：薄い黄
                    socInsText = "#854d0e"; // 文字：濃い黄
                }
                else if (emp.socialInsuranceType === "part_time") {
                    socInsLabel = "パート";
                    socInsBg = "#ffedd5"; // 背景：薄いオレンジ
                    socInsText = "#9a3412"; // 文字：濃いオレンジ
                }
                else if (emp.socialInsuranceType === "none") {
                    socInsLabel = "未加入";
                    socInsBg = "#f3f4f6"; // 背景：薄いグレー
                    socInsText = "#374151"; // 文字：濃いグレー
                }
                const badgeStyle = "display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: bold; border-radius: 4px; margin-right: 4px;";
                // 💡 この1行を tr.innerHTML を定義する「直前」に差し込んでください
                tr.innerHTML = `
<td style="vertical-align: top; padding: 10px 8px;">
  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size:10px; color:#0056b3; font-weight:bold;">
    <span>ID: ${empId}</span>
    ${exemptBadgeHTML}
  </div>
  
  <strong style="font-size: 14px; color: #333; display: block; margin-bottom: 4px;">${empName}</strong>
  
  <div style="margin-bottom: 4px;">
      <span style="${badgeStyle} background-color: #e0f2fe; color: #075985;">
          ${empType}
      </span>
      <span style="${badgeStyle} background-color: ${socInsBg}; color: ${socInsText};">
          ${socInsLabel}
      </span>
  </div>

  ${retroAlertHTML}
</td>

<td style="vertical-align: middle;">
  <span class="disp-h-grade">健保: ${hGrade}</span>等級<br>
  <span style="color: #666;">厚年: ${pGrade}等級</span>
</td>

<td style="vertical-align: middle;">
  <input type="number" class="input-days" value="${savedDays}" readonly 
         title="基礎日数は毎月給与CSVからのみ更新可能です" 
         style="width: 40px; text-align: right; font-size: 14px; border: none; background: transparent; outline: none; cursor: not-allowed; color: #0056b3; font-weight: bold;"> 日
</td>

<td style="vertical-align: middle;">
  <div style="display: flex; align-items: baseline; gap: 6px;">
    <input type="number" class="input-fixed" value="${masterTotalFixed}" readonly 
           title="固定賃金はマスタCSVからのみ更新可能です" 
           style="width: 80px; text-align: right; font-size: 14px; border: none; background: transparent; outline: none; cursor: not-allowed; color: #0056b3; font-weight: bold;">
    <span style="font-size: 13px;">円</span>

    <span class="fixed-wage-breakdown-icon" 
          style="font-size: 11px; color: #0056b3; cursor: pointer; border-bottom: 1px dashed #0056b3; background: #e3f2fd; padding: 2px 6px; border-radius: 4px; margin-left: 4px;"
          onclick="alert('【 ${empName} 様の給与内訳 】\\n\\n 基本給: ${masterBase.toLocaleString()} 円\\n 役職手当: ${masterRole.toLocaleString()} 円\\n家族手当: ${masterFamily.toLocaleString()} 円\\n住宅手当: ${masterHousing.toLocaleString()} 円\\n固定残業代: ${masterFixedOt.toLocaleString()} 円\\n通勤交通費: ${masterCommute.toLocaleString()} 円')">
      🔍
    </span>
  </div>
</td>
             
<td style="vertical-align: middle;">
  <div style="display: flex; align-items: baseline; gap: 6px;">
    <input type="number" class="input-nonfixed" value="${savedNonFixed}" readonly 
           title="非固定賃金は毎月給与CSVからのみ更新可能です" 
           style="width:80px; text-align: right; font-size: 14px; border:none; background:transparent; outline:none; cursor:not-allowed; color:#0056b3; font-weight:bold;">
    <span style="font-size: 13px;">円</span>
  </div>
</td>

<td class="calc-total-cell" style="vertical-align: middle; text-align: right; font-weight: bold; color: #0056b3; font-size: 14px; padding-bottom: 6px;">
  <span class="calc-total">${initialTotal.toLocaleString()}</span>
  <span style="font-size: 12px; margin-left: 2px;">円</span>
  ${adjBadgeHTML} 
</td>

<td style="background:#fff3cd; padding:8px; min-width:160px; vertical-align: middle;">
  <div style="display:flex; justify-content:space-between; color:#555; font-size:11px;">
    <span>健康保険:</span><span class="calc-health-premium">${currentHealthPremium.toLocaleString()}円</span>
  </div>
  <div style="display:flex; justify-content:space-between; color:#555; font-size:11px;">
    <span>介護保険:</span><span>${currentNursingPremium.toLocaleString()}円</span>
  </div>
  <div style="display:flex; justify-content:space-between; color:#555; font-size:11px;">
    <span>厚生年金:</span><span>${currentPensionPremium.toLocaleString()}円</span>
  </div>
  
  <div style="display:flex; justify-content:space-between; color:#856404; font-size:11px; margin-top: 2px;">
    <span>子育て支援金:</span><span>${childSupportEmp.toLocaleString()}円</span>
  </div>

  <div style="display:flex; justify-content:space-between; font-weight:bold; color:#d32f2f; font-size:12px; margin-top:4px; padding-top:4px; border-top:1px dashed #ccc;">
    <span>本人負担 計:</span>
    <span class="calc-total-emp">${(currentHealthPremium + currentNursingPremium + currentPensionPremium + childSupportEmp).toLocaleString()}円</span>
  </div>
        
  ${burdenHTML}
</td>

<td style="text-align: center; vertical-align: middle;">
  <button class="btn-indiv-save" style="padding:4px 12px; font-size:12px; font-weight:bold; cursor:pointer; background:#0056b3; color:white; border:none; border-radius:4px;">保存</button><br>
  <button class="btn-toggle-adjust" style="margin-top:8px; padding:3px 8px; font-size:11px; cursor:pointer; background:#fff; border:1px solid #ccc; border-radius:4px;">⚙️ 調整</button>
</td>
`;
                tbody.appendChild(tr);
                // const fixedInput = tr.querySelector('.input-fixed') as HTMLInputElement;
                // 🌟 NEW: 月額給与用の「算定・月変特記事項メモパネル」
                const adjustTr = document.createElement('tr');
                adjustTr.style.display = "none";
                adjustTr.innerHTML = `
<td colspan="8" style="background: #f8f9fa; padding: 12px; border-bottom: 2px solid #dee2e6;">
  <div style="display: flex; gap: 15px; align-items: center; font-size: 12px; justify-content: flex-end; flex-wrap: wrap;">
    <strong style="color: #0056b3;">📝 算定・月変用の特記事項：</strong>

    <label>理由:</label>
    <select class="input-adj-reason" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
      <option value="">-- 通常の給与 --</option>
      <option value="sokyu" ${savedAdjReason === 'sokyu' ? 'selected' : ''}>遡及適用（ベースUP等の差額）</option>
      <option value="chihai_past" ${savedAdjReason === 'chihai_past' ? 'selected' : ''}>過去分の遅配（単なる支払いズレ）</option>
      <option value="miharai_now" ${savedAdjReason === 'miharai_now' ? 'selected' : ''}>当月分の未払い・遅配（算定除外）</option>
      <option value="kyushoku" ${savedAdjReason === 'kyushoku' ? 'selected' : ''}>休職・一時帰休・ストライキ等（算定除外）</option>
    </select>

    <label>本来の月:</label>
    <select class="input-adj-origin" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
      <option value="">--</option>
      <option value="1">1月分</option><option value="2">2月分</option><option value="3">3月分</option>
      <option value="4">4月分</option><option value="5">5月分</option><option value="6">6月分</option>
      <option value="7">7月分</option><option value="8">8月分</option><option value="9">9月分</option>
      <option value="10">10月分</option><option value="11">11月分</option><option value="12">12月分</option>
    </select>

    <label>金額:</label>
    <input type="number" class="input-adj-amount" value="${savedAdjAmount || ''}" placeholder="例: -50000" style="padding: 4px; width: 110px; border: 1px solid #ccc; border-radius: 4px; text-align: right;"> 円

    <div style="display: flex; gap: 5px; margin-left: 10px;">
      <button class="btn-apply-memo" style="padding: 4px 15px; background: #0056b3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">メモを反映</button>
      <button class="btn-close-adjust" style="padding: 4px 15px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">✖ 閉じる</button>
    </div>
  </div>
</td>
`;
                tbody.appendChild(adjustTr);
                // ⚙️ アコーディオンを開くイベント
                tr.querySelector('.btn-toggle-adjust')?.addEventListener('click', () => {
                    adjustTr.style.display = adjustTr.style.display === "none" ? "table-row" : "none";
                });
                // ✖️ アコーディオンを閉じるイベント（リクエスト対応！）
                adjustTr.querySelector('.btn-close-adjust')?.addEventListener('click', () => {
                    adjustTr.style.display = "none";
                });
                // 🌟 NEW: 「メモを反映」ボタンの処理を追加！
                adjustTr.querySelector('.btn-apply-memo')?.addEventListener('click', () => {
                    // 1. 本体の「保存」ボタン（青ボタン）をプログラムから自動でポチッと押す！
                    const saveBtn = tr.querySelector('.btn-indiv-save');
                    if (saveBtn) {
                        saveBtn.click();
                    }
                    // 2. 処理が終わったら、邪魔にならないようにパネルを自動で閉じる！
                    adjustTr.style.display = "none";
                });
                // リアルタイム計算
                const daysInput = tr.querySelector('.input-days');
                const fixedInput = tr.querySelector('.input-fixed');
                const nonFixedInput = tr.querySelector('.input-nonfixed');
                const totalSpan = tr.querySelector('.calc-total');
                const saveBtn = tr.querySelector('.btn-indiv-save');
                // ==========================================
                // 🗡️ ラスボスにトドメを刺す！（合算ボタンの処理）
                // ==========================================
                const btnApplyRetro = tr.querySelector('.btn-apply-retro');
                const healthPremiumSpan = tr.querySelector('.calc-health-premium');
                const totalEmpSpan = tr.querySelector('.calc-total-emp');
                if (btnApplyRetro) {
                    btnApplyRetro.addEventListener('click', () => {
                        // 💡 画面上の「本人負担 計」の計算式の最後に、すべての差額を足し込む！
                        const newTotal = currentHealthPremium + currentNursingPremium + currentPensionPremium + childSupportEmp
                            + retroHealthDiff + retroNursingDiff + retroPensionDiff + retroChildDiff;
                        if (totalEmpSpan)
                            totalEmpSpan.innerText = newTotal.toLocaleString() + '円';
                        // 4. ボタンを「完了」状態にして、2回押せないようにロックする
                        btnApplyRetro.innerText = "合算済み ✅";
                        btnApplyRetro.style.background = "#28a745";
                        btnApplyRetro.disabled = true;
                    });
                }
                // ==========================================
                const calcTotal = () => {
                    // 🌟 1. 各入力欄から数字を取得（ここで調整額も引っ張ってくる！）
                    const currentFixed = Number(fixedInput.value) || 0;
                    const currentNonFixed = Number(nonFixedInput.value) || 0;
                    const currentAdj = Number(adjustTr.querySelector('.input-adj-amount').value) || 0;
                    // 🌟 2. 調整額を含めた合計で画面を書き換える！
                    totalSpan.innerText = (currentFixed + currentNonFixed + currentAdj).toLocaleString();
                    daysInput.style.backgroundColor = (empType === "正社員" && Number(daysInput.value) < 17) ? "#f8d7da" : "white";
                };
                fixedInput.addEventListener('input', calcTotal);
                nonFixedInput.addEventListener('input', calcTotal);
                daysInput.addEventListener('input', calcTotal);
                calcTotal(); // 初期表示時に一度計算を走らせる（今度は調整額を含めて計算される！）
                // ==========================================
                // 🌟 調整アコーディオン内の「（緑ボタン）」の処理
                // ==========================================
                const btnRecalc = adjustTr.querySelector('.btn-apply-recalc');
                if (btnRecalc) {
                    btnRecalc.addEventListener('click', () => {
                        // ボタン自体のフィードバック（連続クリック防止）
                        const originalText = btnRecalc.innerText;
                        btnRecalc.innerText = "計算中...";
                        btnRecalc.style.background = "#17a2b8"; // ちょっと色を変える
                        btnRecalc.disabled = true;
                        // 1. 画面の入力値（基本給・非固定など）を取得
                        const fixed = Number(fixedInput.value) || 0;
                        const nonFixed = Number(nonFixedInput.value) || 0;
                        // 👇 追加：調整額も取得する
                        const adjAmount = Number(adjustTr.querySelector('.input-adj-amount').value) || 0;
                        // 🌟 2. 総支給額を再計算（基本給 ＋ 非固定 ＋ 調整額！）
                        const newTotal = fixed + nonFixed + adjAmount;
                        // 3. 画面の「総支給額」の表示を書き換える
                        // 💡 HTML側のクラス名「calc-total」を正確に取得する！
                        const totalWageSpan = tr.querySelector('.calc-total');
                        if (totalWageSpan) {
                            // 💡 ポイント：数値だけを書き換える（HTML側の「 円」は残す）
                            totalWageSpan.innerText = newTotal.toLocaleString();
                            // UX向上：変更されたことが分かるように一瞬赤く光らせる ✨
                            totalWageSpan.style.color = "#d32f2f";
                            setTimeout(() => totalWageSpan.style.color = "#0056b3", 1000);
                        }
                        // 4. 緑ボタンを元に戻す
                        setTimeout(() => {
                            btnRecalc.innerText = originalText;
                            btnRecalc.style.background = "#28a745"; // 元の緑に戻す
                            btnRecalc.disabled = false;
                        }, 1500);
                    });
                }
                // ⬇️ この下に、以前作成した青い保存ボタンの処理（saveBtn.addEventListener...）が続くイメージです。
                // 個別保存
                saveBtn.addEventListener('click', async () => {
                    saveBtn.innerText = "保存中...";
                    // 🌟 1. 画面上の入力欄から最新の値を取得（計算用）
                    const valDays = Number(daysInput.value) || 0;
                    const valFixed = Number(fixedInput.value) || 0;
                    const valNonFixed = Number(nonFixedInput.value) || 0;
                    // アコーディオンに入力された値を取得
                    const adjAmount = Number(adjustTr.querySelector('.input-adj-amount').value) || 0;
                    const adjReason = adjustTr.querySelector('.input-adj-reason').value;
                    // 🌟 NEW: 追加した「本来の月（origin）」も取得！
                    const adjOrigin = adjustTr.querySelector('.input-adj-origin').value;
                    // 保存する時の合計額にも、調整額を合算する！
                    const newTotalWage = valFixed + valNonFixed + adjAmount;
                    console.log("【青ボタン押下チェック】", {
                        基本給: valFixed,
                        非固定: valNonFixed,
                        調整額: adjAmount,
                        本来の月: adjOrigin,
                        合計: newTotalWage
                    });
                    saveBtn.disabled = true;
                    try {
                        const recordId = `${currentYear}_${currentMonth}_${empId}`;
                        await setDoc(doc(db, "monthly_payroll_records", recordId), {
                            employeeId: empId,
                            companyId: currentCompanyId,
                            year: currentYear,
                            month: currentMonth,
                            days: valDays,
                            fixedWage: valFixed,
                            nonFixedWage: valNonFixed,
                            totalWage: newTotalWage, // 👈 変更後の合計値で保存
                            retroHealthAmount: retroHealthDiff,
                            retroNursingAmount: retroNursingDiff,
                            retroPensionAmount: retroPensionDiff,
                            retroChildAmount: retroChildDiff,
                            retroApplied: true,
                            healthPremium: currentHealthPremium, // 健保
                            nursingPremium: currentNursingPremium, // 介護
                            pensionPremium: currentPensionPremium, // 厚年
                            childSupportEmp: childSupportEmp, // 子育て支援金（本人負担）
                            updatedAt: new Date(),
                            adjustmentAmount: adjAmount,
                            adjustmentReason: adjReason,
                            adjustmentOriginMonth: adjOrigin, // 💡 NEW: 本来の月もFirebaseに保存！
                            // =========================================================
                            // 🌟 NEW: 過去月ブロック（スナップショット）機能！
                            // 保存した瞬間のマスタの基本給・手当をそのままの姿で焼き付ける！
                            // =========================================================
                            baseSalary: masterBase,
                            allowanceRole: masterRole,
                            allowanceFamily: masterFamily,
                            allowanceHousing: masterHousing,
                            allowanceFixedOt: masterFixedOt,
                            allowanceCommute: masterCommute
                        }, { merge: true });
                        // 🌟 2. 画面上の「総支給額」の表示も最新の金額に書き換える！
                        const totalCell = tr.querySelector('.calc-total-cell');
                        if (totalCell) {
                            // ① 今保存した値（adjReason, adjAmount, adjOrigin）を元に、新しい注釈テキストを生成
                            let newAdjBadgeHTML = "";
                            const originText = adjOrigin ? `${adjOrigin}月分の` : ""; // 例: "3月分の"
                            if ((adjReason === "sokyu" || adjReason === "chihai_past") && adjAmount !== 0) {
                                // 遡及や過去遅配の場合（金額あり）
                                const sign = adjAmount > 0 ? "+" : "";
                                const reasonName = adjReason === "sokyu" ? "遡及適用等" : "過去分遅配";
                                newAdjBadgeHTML = `<br><span style="font-size: 11px; color: #d32f2f; font-weight: normal;">(${originText}${reasonName} ${sign}${adjAmount.toLocaleString()}円)</span>`;
                            }
                            else if (adjReason === "miharai_now" || adjReason === "kyushoku") {
                                // 当月未払いや休職の場合（金額なし・算定除外）
                                const reasonName = adjReason === "miharai_now" ? "当月未払い" : "休職等";
                                newAdjBadgeHTML = `<br><span style="font-size: 11px; color: #6c757d; font-weight: normal;">(⚠️ 算定除外: ${reasonName})</span>`;
                            }
                            // ② 総支給額を表示しているセル（td）の中身を、数字＋注釈で丸ごと上書き！
                            totalCell.innerHTML = `
        <span class="calc-total">${newTotalWage.toLocaleString()}</span>
        <span style="font-size: 12px; margin-left: 2px;">円</span>
        ${newAdjBadgeHTML}
      `;
                        }
                        saveBtn.innerText = "完了✓";
                        saveBtn.style.background = "#28a745";
                        saveBtn.style.color = "white";
                        setTimeout(() => { saveBtn.innerText = "保存"; saveBtn.style.background = ""; saveBtn.style.color = ""; saveBtn.disabled = false; }, 2000);
                    }
                    catch (e) {
                        console.error("Firebase保存エラー:", e); // デバッグ用にコンソールにエラーを出力
                        alert("保存に失敗しました");
                        saveBtn.innerText = "エラー";
                        saveBtn.disabled = false;
                    }
                });
            });
            // ==========================================
            // ⚡ 圧倒的UX：一括合算ボタンの自動生成ロジック
            // ==========================================
            // 月を切り替えた時にボタンが増殖しないよう、前回のボタンがあれば消す
            const existingBulkBtn = document.getElementById('wrap-bulk-retro');
            if (existingBulkBtn)
                existingBulkBtn.remove();
            // 画面上に「今月に合算する」ボタンが何個あるか探す
            const retroBtns = document.querySelectorAll('.btn-apply-retro:not([disabled])');
            // 💡 1つ以上アラートがあれば、テーブルの上に一括ボタンを自動出現させる！
            if (retroBtns.length > 0 && tbody && tbody.parentElement) {
                const bulkBtnWrapper = document.createElement('div');
                bulkBtnWrapper.id = 'wrap-bulk-retro';
                bulkBtnWrapper.style.textAlign = 'right'; // 右寄せで配置
                bulkBtnWrapper.style.marginBottom = '10px';
                bulkBtnWrapper.innerHTML = `
        <button id="btn-bulk-retro" style="background: #f57c00; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          ⚡ 遡及対象者（${retroBtns.length}名）を一括合算する
        </button>
      `;
                // テーブル要素の直前にボタンを挿入
                tbody.parentElement.insertAdjacentElement('beforebegin', bulkBtnWrapper);
                // 一括ボタンを押した時の魔法のアクション
                const bulkBtn = document.getElementById('btn-bulk-retro');
                bulkBtn.addEventListener('click', () => {
                    if (confirm(`⚠️ 対象者 ${retroBtns.length} 名の差額をすべて合算しますか？`)) {
                        // 💡 魔法の処理：画面上の個別ボタンを「JSの力で全部一気にクリック」する！
                        retroBtns.forEach(btn => {
                            btn.click();
                        });
                        // ボタンのデザインを完了状態にする
                        bulkBtn.innerText = "✅ 全員分の一括合算が完了しました";
                        bulkBtn.style.background = "#28a745";
                        bulkBtn.disabled = true;
                        alert("一括合算が完了しました！右下の「この月の実績を確定する（一括保存）」を押して保存してください。");
                    }
                });
            }
        }
        catch (e) { }
        // ==================================================
        // 🌟 今回追加する「労働期間ガイド」の自動更新処理（会社ID対応版）
        // ==================================================
        try {
            // 🌟 1. 現在ログイン中の会社IDを取得！
            const currentCompanyId = localStorage.getItem('current_company_id');
            if (!currentCompanyId) {
                console.error("❌ 会社IDが取得できないため、期間計算をスキップしました。");
                return;
            }
            // 🌟 2. その会社の正しい設定ドキュメントを取得（'companies' または 'settings'）
            // ※ もし元のコードが 'settings' コレクションだった場合は doc(db, 'settings', currentCompanyId) にしてください
            const companySnap = await getDoc(doc(db, 'companies', currentCompanyId));
            const companyMaster = companySnap.exists() ? companySnap.data() : {};
            // 🔍 デバッグ用：F12のコンソールに「実際にDBから取れた中身」を映し出す！
            console.log("📦 DBから取得した会社マスタ:", companyMaster);
            // 🌟 3. フィールド名の表記ブレ（キャメルケース / HTMLのID名）を両方カバーして救い出す！
            // 🌟 データの読み取り部分をこれに差し替える！
            const cutoffDay = companyMaster.cutoffDay || "末"; // DBの cutoffDay を探す
            const payTiming = companyMaster.paymentMonth || "next"; // DBの paymentMonth を探す
            console.log(`🔍 デバッグ：取得した設定 -> 締め日: ${cutoffDay}, 支払月: ${payTiming}`);
            let startStr = "";
            let endStr = "";
            // 4. 締め日と支払月に応じて期間を自動計算
            if (cutoffDay === "末" || cutoffDay === "末日") {
                if (payTiming === "current" || payTiming === "当月払い") {
                    startStr = `${currentMonth}月1日`;
                    endStr = `${currentMonth}月末日`;
                }
                else {
                    const prevDate = new Date(currentYear, currentMonth - 2, 1);
                    startStr = `${prevDate.getMonth() + 1}月1日`;
                    endStr = `${prevDate.getMonth() + 1}月末日`;
                }
            }
            else {
                const cutoff = parseInt(cutoffDay, 10);
                if (payTiming === "current" || payTiming === "当月払い") {
                    const prevDate = new Date(currentYear, currentMonth - 2, 1);
                    startStr = `${prevDate.getMonth() + 1}月${cutoff + 1}日`;
                    endStr = `${currentMonth}月${cutoff}日`;
                }
                else {
                    const prevPrevDate = new Date(currentYear, currentMonth - 3, 1);
                    const prevDate = new Date(currentYear, currentMonth - 2, 1);
                    startStr = `${prevPrevDate.getMonth() + 1}月${cutoff + 1}日`;
                    endStr = `${prevDate.getMonth() + 1}月${cutoff}日`;
                }
            }
            // 5. テキストを画面の箱（<span>）に反映（無敵仕様）
            const guideDiv = document.getElementById('salary-period-guide') || document.getElementById('display-target-period');
            if (guideDiv) {
                guideDiv.innerText = `（${startStr} 〜 ${endStr} 稼働分）`;
                guideDiv.style.color = "#0056b3"; // ついでに文字色を青にして目立たせます！
            }
            else {
                console.error("❌ 画面に期間を表示する箱(span)が見つかりません！");
            }
        }
        catch (e) {
            console.error("ガイドテキスト更新エラー:", e);
            const guideDiv = document.getElementById('display-target-period');
            if (guideDiv)
                guideDiv.innerText = `（期間を取得できませんでした）`;
        }
        // 👆==== ここまで追加 ====👆
        // 【B】虫眼鏡の叩き起こし魔法（給与タブ用）
        document.getElementById('search-salary-emp')?.dispatchEvent(new Event('input'));
    };
    // 💡 修正2：「給与」タブがクリックされたら、毎回最新データで画面を再構築する！
    const salaryTabBtn = document.querySelector('[data-tab="tab-salary"]');
    if (salaryTabBtn) {
        salaryTabBtn.addEventListener('click', () => {
            loadMonthlyData();
        });
    }
    // 🔍 リアルタイム社員検索の制御ロジック
    const searchSalaryEmp = document.getElementById('search-salary-emp');
    if (searchSalaryEmp) {
        searchSalaryEmp.addEventListener('input', (e) => {
            // 💡 1. 検索ワードを取得して空白をすべて消す！
            const searchTerm = e.target.value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
            // 💡 2. テーブルの行（rows）をすべて取得する！（👈 これが消えちゃってました！）
            const rows = document.querySelectorAll('#salary-input-body tr');
            // 💡 3. ループで行を1つずつチェックする
            rows.forEach((row) => {
                const tr = row;
                // 読み込み中などのシステム行は無視
                if (tr.cells.length < 2)
                    return;
                // 💡 4. その行の「一番左のセル(cells[0])」の文字だけを取得して空白を消す！（👈 trはここじゃないと使えません！）
                const rowText = (tr.cells[0]?.innerText || "").normalize('NFKC').toLowerCase().replace(/\s+/g, '');
                // 検索ワードが含まれていれば表示、なければ隠す
                if (rowText.includes(searchTerm)) {
                    tr.style.display = '';
                }
                else {
                    tr.style.display = 'none';
                }
            });
        });
    }
    // ==========================================
    // ボタンのイベント設定
    // ==========================================
    const prevBtn = document.getElementById('btn-prev-month');
    const nextBtn = document.getElementById('btn-next-month');
    // イベントの重複を防ぐためにクローン
    const newPrevBtn = prevBtn?.cloneNode(true);
    const newNextBtn = nextBtn?.cloneNode(true);
    prevBtn?.parentNode?.replaceChild(newPrevBtn, prevBtn);
    nextBtn?.parentNode?.replaceChild(newNextBtn, nextBtn);
    newPrevBtn?.addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 1) {
            currentMonth = 12;
            currentYear--;
        }
        loadMonthlyData(); // 🔄 月を変えたらデータを再読み込み！
    });
    newNextBtn?.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        }
        loadMonthlyData(); // 🔄 月を変えたらデータを再読み込み！
    });
    // 初回読み込みを実行！
    loadMonthlyData();
    // (※この下にある「一括保存」「月額変更CSV出力」「CSVインポート」のコードは消さずにそのまま残してください！)
    // ==========================================
    // 📥 【機能③】e-Gov用 CSVのリアル・ダウンロード機能
    // ==========================================
    // 📥 e-Gov用 CSV出力ボタン（随時改定タブ版にアップデート！）
    document.getElementById('btn-export-egov-geppen')?.addEventListener('click', () => {
        // 🌟 1. 随時改定タブの「プルダウン」から対象の年月を取得する
        const targetSelect = document.getElementById('zuiji-target-month');
        const revisionMonth = Number(targetSelect?.value || 7);
        const optionText = targetSelect.options[targetSelect.selectedIndex]?.text || "";
        const revisionYear = parseInt(optionText.match(/\d{4}/)?.[0] || String(new Date().getFullYear()));
        console.log(`📥 ${revisionYear}年${revisionMonth}月 改定予定のe-Gov CSVを出力します...`);
        // 🌟 2. 古い長ったらしいコードは全部消して、最強エンジンを呼び出すだけ！
        // （プルダウンで選んだ年・月をエンジンに渡す）
        downloadGeppenCSV(revisionYear, revisionMonth);
    });
    // ==========================================
    // 🚀 給与CSVインポートエンジン（内訳フル連動版）
    // ==========================================
    const csvBtn = document.getElementById('btn-csv-import');
    const csvInput = document.getElementById('csv-upload');
    // 🌟 犯人退治！上の古い addEventListener を消して onclick に一本化！
    if (csvBtn) {
        csvBtn.onclick = () => {
            if (csvInput)
                csvInput.click();
        };
    }
    // 🌟 ファイル読み込み側も onchange で一本化！
    if (csvInput) {
        csvInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result;
                const lines = text.split('\n');
                let successCount = 0;
                for (let i = 1; i < lines.length; i++) {
                    const currentLine = lines[i];
                    if (!currentLine || !currentLine.trim())
                        continue;
                    const cols = currentLine.split(',');
                    // 💡 4列から9列に変更！
                    if (cols.length >= 9) {
                        const targetId = cols[0]?.trim();
                        const days = cols[1]?.trim();
                        // 💡 固定賃金の内訳をそれぞれ数値として取得（空欄なら0）
                        const base = Number(cols[2]?.trim()) || 0;
                        const role = Number(cols[3]?.trim()) || 0;
                        const family = Number(cols[4]?.trim()) || 0;
                        const housing = Number(cols[5]?.trim()) || 0;
                        const fixedOt = Number(cols[6]?.trim()) || 0;
                        const commute = Number(cols[7]?.trim()) || 0;
                        const nonFixed = cols[8]?.trim();
                        if (!targetId)
                            continue;
                        const targetRow = document.querySelector(`tr[data-emp-id="${targetId}"]`);
                        if (targetRow) {
                            // 1. 固定賃金の合計をここで計算！
                            const totalFixed = base + role + family + housing + fixedOt + commute;
                            // 2. 画面の入力欄に流し込む
                            targetRow.querySelector('.input-days').value = days || "0";
                            targetRow.querySelector('.input-fixed').value = String(totalFixed);
                            targetRow.querySelector('.input-nonfixed').value = nonFixed || "0";
                            // 再計算のトリガーを引く
                            targetRow.querySelector('.input-days').dispatchEvent(new Event('input'));
                            // 3. 内訳ポップアップ（🔍）の中身も上書き！
                            const newBreakdownText = `【CSV読込データ】\\n`
                                + `基本給: ${base.toLocaleString()}円\\n`
                                + `役職手当: ${role.toLocaleString()}円\\n`
                                + `家族手当: ${family.toLocaleString()}円\\n`
                                + `住宅手当: ${housing.toLocaleString()}円\\n`
                                + `固定残業代: ${fixedOt.toLocaleString()}円\\n`
                                + `通勤交通費: ${commute.toLocaleString()}円\\n`
                                + `------------------------\\n`
                                + `合計: ${totalFixed.toLocaleString()}円`;
                            const breakdownIcon = targetRow.querySelector('.fixed-wage-breakdown-icon');
                            if (breakdownIcon) {
                                breakdownIcon.setAttribute('onclick', `alert('${newBreakdownText}')`);
                            }
                            successCount++;
                        }
                    }
                }
                alert(`✅ CSVの読み込み完了！\n${successCount}名分の給与データと内訳を自動入力しました。`);
                csvInput.value = "";
            };
            // 🌟 完璧な Shift-JIS 対応
            reader.readAsText(file, 'Shift_JIS');
        };
    }
    // ==========================================
    // 🏢 従業員マスタ（一括昇給・手当更新）CSVインポートエンジン
    // ==========================================
    const masterCsvBtn = document.getElementById('btn-master-csv-import');
    const masterCsvInput = document.getElementById('master-csv-upload');
    // 🌟 ファントム退治1：addEventListenerをやめて onclick で「絶対上書き」にする！
    if (masterCsvBtn) {
        masterCsvBtn.onclick = () => {
            if (masterCsvInput)
                masterCsvInput.click();
        };
    }
    // 🌟 ファントム退治2：こちらも onchange で「絶対上書き」にする！
    if (masterCsvInput) {
        masterCsvInput.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            if (!confirm('⚠️ 読み込んだCSVデータで、従業員マスタ（基本給・各種手当）を一括で上書き（昇給）します。\nよろしいですか？')) {
                masterCsvInput.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onload = async (event) => {
                const text = event.target?.result;
                const lines = text.split('\n');
                let successCount = 0;
                try {
                    // 🌟 1. 会社IDを取得して防壁を張る！
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("会社情報が読み込めないため、一括更新を中止しました。");
                        return;
                    }
                    // 🌟 2. 【超重要】「自社」の従業員だけを絞り込んで取得！！！（他社との社員番号被りによる誤爆を完全に防ぐ）
                    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                    const usersSnap = await getDocs(usersQuery);
                    const usersList = [];
                    usersSnap.forEach(d => usersList.push({ realFirebaseId: d.id, ...d.data() }));
                    const displayIdToRealIdMap = new Map();
                    usersList.forEach(emp => {
                        const displayId = String(emp.employeeId || emp.employeeNumber || emp.id);
                        displayIdToRealIdMap.set(displayId, emp.realFirebaseId);
                    });
                    const batch = writeBatch(db);
                    for (let i = 1; i < lines.length; i++) {
                        const currentLine = lines[i];
                        if (!currentLine || !currentLine.trim())
                            continue;
                        const cols = currentLine.split(',');
                        // =========================================================
                        // 💡 7項目から9項目に変更（緑ボタンと同じCSVフォーマットに統一！）
                        // =========================================================
                        if (cols.length >= 9) {
                            const targetId = cols[0]?.trim();
                            // 💡 cols[1] は「基礎日数」なので、マスタデータベースの更新では無視（スルー）します
                            if (!targetId)
                                continue;
                            const realDocId = displayIdToRealIdMap.get(targetId);
                            if (!realDocId) {
                                console.warn(`ID: ${targetId} は見つかりませんでした。スキップします。`);
                                continue;
                            }
                            // 💡 9列CSVの並びに合わせて、取得する列（インデックス）を 2〜7 にズラす！
                            // (0:ID, 1:日数, 2:基本給, 3:役職, 4:家族, 5:住宅, 6:固定残業, 7:通勤, 8:非固定)
                            const newBase = Number(cols[2]?.trim()) || 0;
                            const newRole = Number(cols[3]?.trim()) || 0;
                            const newFamily = Number(cols[4]?.trim()) || 0;
                            const newHousing = Number(cols[5]?.trim()) || 0;
                            const newFixedOt = Number(cols[6]?.trim()) || 0;
                            const newCommute = Number(cols[7]?.trim()) || 0;
                            // 💡 cols[8] は「非固定賃金」なのでこれもスルーします
                            const userRef = doc(db, 'users', realDocId);
                            batch.set(userRef, {
                                baseHealth: newBase,
                                basePension: newBase,
                                allowances: {
                                    role: newRole,
                                    family: newFamily,
                                    housing: newHousing,
                                    fixedOt: newFixedOt,
                                    commute: newCommute
                                },
                                updatedAt: new Date()
                            }, { merge: true });
                            successCount++;
                        }
                    }
                    await batch.commit();
                    alert(`🏆 マスタの昇給・更新完了！\n${successCount}名分の基本給・手当マスタを一括で書き換えました。`);
                    // =========================================================
                    // 💡 超重要：更新後、画面を自動でリロードして最新の給与マスタを反映させる！
                    // =========================================================
                    window.location.reload();
                }
                catch (error) {
                    console.error("マスタCSV更新エラー:", error);
                    alert("マスタの更新中にエラーが発生しました。");
                }
                finally {
                    masterCsvInput.value = "";
                }
            };
            reader.readAsText(file, 'Shift_JIS');
        };
    }
    // ==========================================
    // 🌟 修正版：月の実績を確定する（一括保存＆月変アラート）
    // ==========================================
    const btnSaveMonthly = document.getElementById('btn-save-monthly');
    if (btnSaveMonthly) {
        const newBtnSaveMonthly = btnSaveMonthly.cloneNode(true);
        btnSaveMonthly.parentNode?.replaceChild(newBtnSaveMonthly, btnSaveMonthly);
        newBtnSaveMonthly.addEventListener('click', async () => {
            const alertBox = document.getElementById('monthly-change-alert');
            const alertList = document.getElementById('alert-list');
            newBtnSaveMonthly.innerText = "⏳ データを保存中...";
            newBtnSaveMonthly.disabled = true;
            try {
                // =========================================================
                // 🌟 修正1：バッチ保存をやめ、完璧な個別保存ボタンを一斉クリック！
                // =========================================================
                const individualSaveBtns = document.querySelectorAll('.btn-indiv-save');
                if (individualSaveBtns.length === 0) {
                    alert("保存できるデータがありません。");
                    newBtnSaveMonthly.innerText = "💾 この月の実績を確定する（一括保存）";
                    newBtnSaveMonthly.disabled = false;
                    return;
                }
                // 全員の個別保存ボタン（保険料計算済みの完璧なコード）を一斉発動！
                individualSaveBtns.forEach(btn => {
                    btn.click();
                });
                // 🌟 修正2：個別保存の完了（Firestoreへの書き込み）を確実に待つ
                // （これをしないと、直後のタスク検知ロジックが古いデータを読み込んでしまうため）
                await new Promise(resolve => setTimeout(resolve, 1500));
                // =========================================================
                // 🌟 ここから下は竹高さんの「随時改定検知＆タスク生成ロジック」を完全再現！
                // =========================================================
                const currentCompanyId = localStorage.getItem('current_company_id');
                if (!currentCompanyId)
                    return;
                const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
                const usersSnapshot = await getDocs(usersQuery);
                const employees = [];
                usersSnapshot.forEach((doc) => employees.push({ id: doc.id, ...doc.data() }));
                const payrollQuery = query(collection(db, "monthly_payroll_records"), where("companyId", "==", currentCompanyId));
                const payrollSnapshot = await getDocs(payrollQuery);
                const payrollRecords = [];
                payrollSnapshot.forEach((doc) => payrollRecords.push(doc.data()));
                let nextMonth = currentMonth + 1;
                let nextYear = currentYear;
                if (nextMonth > 12) {
                    nextMonth = 1;
                    nextYear += 1;
                }
                const targets = getZuijiTargets(nextYear, nextMonth, employees, payrollRecords);
                if (alertBox && alertList) {
                    if (targets.length > 0) {
                        let geppenTargetsHTML = '';
                        const targetNames = targets.map((t) => t.name);
                        targets.forEach((t) => {
                            geppenTargetsHTML += `<li><strong>ID: ${t.id} ${t.name}</strong>: 新しい平均給与(${t.avgWage.toLocaleString()}円)により、現在の${t.currentGrade}等級から<strong>${t.newGrade}等級（${t.gradeDiff}等級差）</strong>へ変動する見込みです。</li>`;
                        });
                        alertList.innerHTML = geppenTargetsHTML;
                        alertBox.style.display = 'block';
                        let displayNames = targetNames.join('、');
                        if (targetNames.length > 3) {
                            displayNames = `${targetNames[0]}、${targetNames[1]} 等 (計${targetNames.length}名)`;
                        }
                        // 🌟 会社IDごとにローカルストレージの保存キーを分ける！
                        const taskKey = `hr_tasks_${currentCompanyId}`;
                        const savedTasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
                        const taskTitle = `【重要】${nextYear}年${nextMonth}月度 月額変更届の作成および提出 (対象: ${targetNames.length}名)`;
                        const exists = savedTasks.some((t) => t.title === taskTitle);
                        if (!exists) {
                            const newTask = {
                                id: Date.now().toString(),
                                title: taskTitle,
                                empName: displayNames,
                                agency: '年金事務所',
                                status: 'todo',
                                deadline: `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`,
                                source: '自動検知（随時改定）',
                                createdAt: new Date().toISOString(),
                                memo: `給与タブにて ${targetNames.length} 名の月変更対象者が検出されました。年金事務所へ提出してください。\n\n【対象者全員】\n${targetNames.join('\n')}`
                            };
                            savedTasks.push(newTask);
                            localStorage.setItem(taskKey, JSON.stringify(savedTasks)); // 🌟 会社別のキーで保存！
                        }
                    }
                    else {
                        alertBox.style.display = 'none';
                    }
                }
                alert(`✅ ${currentYear}年${currentMonth}月の実績をデータベースに保存しました！\n（裏側で随時改定の監視ロジックが完了しました）`);
                // window.location.reload();
            }
            catch (error) {
                console.error("月額給与の一括保存中にエラー:", error);
                alert(`保存中にエラーが発生しました。通信環境を確認してください。`);
            }
            finally {
                newBtnSaveMonthly.innerText = "💾 この月の実績を確定する（一括保存）";
                newBtnSaveMonthly.disabled = false;
            }
        });
    }
    // 【A】給与タブのフィルター起動！
    initSalaryFilterUI('btn-salary-active', 'btn-salary-retired', 'salary-emp-filter', 'salary', loadMonthlyData);
}
// ==========================================
// 🎁 賞与（ボーナス）タブ（支給履歴タイムライン・バッジ対応の完全版）
// ==========================================
async function initBonusUI() {
    const tbody = document.getElementById('bonus-input-body');
    if (!tbody)
        return;
    const paymentDateInput = document.getElementById('bonus-payment-date');
    if (!paymentDateInput)
        return;
    // 🔄 支給日ごとにデータを読み込んで画面を描画する関数
    const loadBonusData = async () => {
        const bonusDateInput = document.getElementById('bonus-payment-date');
        let targetYear = new Date().getFullYear();
        let targetMonth = new Date().getMonth() + 1;
        // もし入力欄に日付が入っていれば、それを使う（例: "2026-06-15"）
        if (bonusDateInput && bonusDateInput.value) {
            const dateParts = bonusDateInput.value.split('-'); // ["2026", "06", "15"] に分割
            targetYear = parseInt(dateParts[0], 10);
            targetMonth = parseInt(dateParts[1], 10);
        }
        const companyRates = await fetchCompanyInsuranceSettings(targetYear, targetMonth);
        const currentPaymentDate = paymentDateInput.value || "2026-06-15";
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">🔄 従業員データと【${currentPaymentDate}】の実績を読み込み中...</td></tr>`;
        try {
            // ⭕ 書き換え後
            const currentCompanyId = localStorage.getItem('current_company_id');
            if (!currentCompanyId)
                return;
            const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
            const usersSnapshot = await getDocs(usersQuery);
            const employees = [];
            const currentFilter = localStorage.getItem('bonus_status') || 'active';
            const currentTypeFilter = localStorage.getItem('bonus_type') || 'all';
            usersSnapshot.forEach((doc) => {
                const data = doc.data();
                // 🌟 フィルター処理：条件に合わない人は配列に入れない（弾く）
                if (currentFilter === 'active' && data.employeeStatus !== 'active')
                    return;
                if (currentFilter === 'retired' && data.employeeStatus !== 'retired')
                    return;
                // =========================================================
                // 🌟🌟🌟 【ここに追加！！】区分（社保区分）のフィルター 🌟🌟🌟
                // =========================================================
                const socInsType = data.socialInsuranceType || 'regular';
                if (currentTypeFilter !== 'all') {
                    // 画面のプルダウンの値と一致しない人は弾く！
                    if (socInsType !== currentTypeFilter)
                        return;
                }
                // =========================================================
                employees.push({ id: doc.id, ...data });
            });
            // =========================================================
            // 🌟🌟🌟 【ここに追加！】従業員リストを描画前にID順に並び替える 🌟🌟🌟
            // =========================================================
            employees.sort((a, b) => {
                const idA = String(a.employeeId || a.employeeNumber || a.id || "");
                const idB = String(b.employeeId || b.employeeNumber || b.id || "");
                return idA.localeCompare(idB, undefined, { numeric: true });
            });
            // =========================================================
            // ⭕ 書き換え後
            // 🚨🚨🚨 【最強監視カメラ版】フィルターを外して全部ぶちまける！ 🚨🚨🚨
            console.log(`🚨 [捜査開始] 会社ID【${currentCompanyId}】のデータを金庫から探します！`);
            const allBonusRecords = [];
            try {
                // where(条件)をあえて外して、金庫の中身を「すべて」強制的に持ってくる
                const bonusSnapshot = await getDocs(collection(db, "bonus_payroll_records"));
                let totalCount = 0;
                bonusSnapshot.forEach((doc) => {
                    totalCount++;
                    const data = doc.data();
                    console.log(`📦 [金庫のデータ ${totalCount}] ID: ${doc.id}`, data);
                    // JavaScript側で手動で会社IDを判定する
                    if (data.companyId === currentCompanyId) {
                        allBonusRecords.push(data);
                    }
                });
                console.log(`✅ [捜査結果] この会社の賞与データは ${allBonusRecords.length} 件見つかりました！`);
            }
            catch (error) {
                console.error("🚨 読み込み中にエラー発生！", error);
            }
            // 🚨🚨🚨 ここまで 🚨🚨🚨
            // 🚀 【新機能】Firebaseの全履歴から「支給日」だけをダブりなく抽出して並べる（赤いカレンダーバッジ）
            const historyContainer = document.getElementById('bonus-history-container');
            if (historyContainer) {
                historyContainer.innerHTML = '';
                // 重複を除外して日付順にソート
                const uniqueDates = [...new Set(allBonusRecords.map(r => r.paymentDate))].sort();
                if (uniqueDates.length === 0) {
                    historyContainer.innerHTML = `<span style="font-size: 11px; color: #999;">（まだ確定した実績はありません）</span>`;
                }
                else {
                    uniqueDates.forEach(dateStr => {
                        const badge = document.createElement('button');
                        // 💡 ユーザーの「支払日を赤くする」イメージを形にした、クリックできる赤い丸付きバッジ
                        badge.style.cssText = "padding: 2px 10px; background: #fff; border: 1px solid #dc3545; color: #dc3545; border-radius: 12px; font-size: 11px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 4px; transition: all 0.2s;";
                        badge.innerHTML = `🔴 ${dateStr}`;
                        // 現在選択中の日付バッジは、背景を赤くして分かりやすくする
                        if (dateStr === currentPaymentDate) {
                            badge.style.background = "#dc3545";
                            badge.style.color = "#fff";
                        }
                        // 💡 過去の支払日バッジを押したら、カレンダーの日付が変わり、その日のデータが瞬間復元！
                        badge.addEventListener('click', () => {
                            paymentDateInput.value = dateStr;
                            loadBonusData();
                        });
                        historyContainer.appendChild(badge);
                    });
                }
            }
            tbody.innerHTML = '';
            if (employees.length === 0)
                return;
            const HEALTH_BONUS_MAX = 5730000;
            const PENSION_BONUS_MAX = 1500000;
            const currentBonusDataList = [];
            employees.forEach((emp, index) => {
                const lastName = emp.lastNameKanji || "";
                const firstName = emp.firstNameKanji || "";
                const empName = (lastName || firstName) ? `${lastName} ${firstName}`.trim() : "名称未設定";
                const empId = emp.employeeId || emp.employeeNumber || emp.id;
                // 今年度の「過去の支給分（今回の日は除く）」の健保対象額を集計して二重加算防止
                const pastRecords = allBonusRecords.filter(r => r.employeeId === empId &&
                    r.paymentDate >= "2026-04-01" &&
                    r.paymentDate <= "2027-03-31" &&
                    r.paymentDate !== currentPaymentDate);
                const cumulativeHealthBonus = pastRecords.reduce((sum, r) => sum + (r.healthTarget || 0), 0);
                const remainingHealthLimit = Math.max(0, HEALTH_BONUS_MAX - cumulativeHealthBonus);
                // 🌟🌟🌟 これを以下の最強コードにまるっと書き換える！ 🌟🌟🌟
                const safeEmpId = String(emp.employeeId || emp.employeeNumber || emp.id).trim();
                const safeRealId = String(emp.id).trim();
                const currentRecord = allBonusRecords.find(r => {
                    const rEmpId = String(r.employeeId || "").trim();
                    const rRealId = String(r.realDocId || "").trim();
                    // 画面のID（000033）か、本当のID（aB3x...）のどちらかが一致すればOK！
                    return (rEmpId === safeEmpId || rRealId === safeRealId) && r.paymentDate === currentPaymentDate;
                });
                const savedBonusWage = currentRecord ? (Number(currentRecord.bonusWage) || 0) : 0;
                // 🕵️‍♂️ 監視カメラ（F12コンソール用）
                if (savedBonusWage > 0) {
                    console.log(`🎉 照合成功！社員【${safeEmpId}】の保存データ ${savedBonusWage}円 を発見！`);
                }
                // 🌟🌟🌟 ここまで 🌟🌟🌟
                // 👇＝＝＝ ここから追加（年4回特例の判定） ＝＝＝👇
                // 🌟 算定基礎の期間（前年7月〜今年6月）を特定
                let startYear = targetYear;
                if (targetMonth < 7) {
                    startYear -= 1;
                }
                const periodStart = `${startYear}-07-01`;
                const periodEnd = `${startYear + 1}-06-30`;
                // 🌟 対象期間内の「今回の入力を含む」賞与回数をカウント
                // ※ 今回の支給日(currentPaymentDate)が期間内であれば、既存の保存データ(allBonusRecords)と合わせてカウント
                let bonusCountInPeriod = allBonusRecords.filter(b => String(b.employeeId) === String(empId) &&
                    b.paymentDate >= periodStart &&
                    b.paymentDate <= periodEnd &&
                    b.paymentDate !== currentPaymentDate // 今回分は別途カウントする
                ).length;
                // 今回の画面に入力しようとしている（または保存済みの）データが対象期間内なら +1
                if (currentPaymentDate >= periodStart && currentPaymentDate <= periodEnd) {
                    bonusCountInPeriod += 1;
                }
                let bonusAlertBadge = "";
                if (bonusCountInPeriod >= 4) {
                    bonusAlertBadge = `
                  <div style="margin-top: 6px;">
                      <span style="display:inline-block; padding: 3px 6px; background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba; border-radius: 4px; font-size: 11px; font-weight: bold; line-height: 1.2;">
                          ⚠️ 算定月額加算対象(年${bonusCountInPeriod}回)
                      </span>
                  </div>
              `;
                }
                // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
                const tr = document.createElement('tr');
                tr.setAttribute('data-bonus-emp-id', empId);
                // ==========================================
                // 🌟 UI改善：社保区分のバッジ作成ロジック（賞与画面用）
                // 💡 変数名の衝突（Viteエラー）を完全に防ぐため、名前に「badge」をつけています
                // ==========================================
                const badgeEmpType = emp.empType || emp.contractInfo?.empType || "未設定";
                let badgeSocInsLabel = "一般";
                let badgeSocInsBg = "#d1fae5"; // 背景：薄い緑
                let badgeSocInsText = "#065f46"; // 文字：濃い緑
                if (emp.socialInsuranceType === "short_time") {
                    badgeSocInsLabel = "短時間";
                    badgeSocInsBg = "#fef08a"; // 背景：薄い黄
                    badgeSocInsText = "#854d0e"; // 文字：濃い黄
                }
                else if (emp.socialInsuranceType === "part_time") {
                    badgeSocInsLabel = "パート";
                    badgeSocInsBg = "#ffedd5"; // 背景：薄いオレンジ
                    badgeSocInsText = "#9a3412"; // 文字：濃いオレンジ
                }
                else if (emp.socialInsuranceType === "none") {
                    badgeSocInsLabel = "未加入";
                    badgeSocInsBg = "#f3f4f6"; // 背景：薄いグレー
                    badgeSocInsText = "#374151"; // 文字：濃いグレー
                }
                const badgeStyle = "display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: bold; border-radius: 4px; margin-right: 4px;";
                // 💡 1列目だけバッジ仕様に差し替え！2列目以降は竹高さんの完璧なコードをそのまま残しています！
                tr.innerHTML = `
            <td style="vertical-align: top; padding: 12px 10px;">
              <strong style="font-size: 14px; color: #333; display: block; margin-bottom: 4px;">${empName}</strong>
              
              <div style="margin-bottom: 4px;">
                  <span style="${badgeStyle} background-color: #e0f2fe; color: #075985;">
                      ${badgeEmpType}
                  </span>
                  <span style="${badgeStyle} background-color: ${badgeSocInsBg}; color: ${badgeSocInsText};">
                      ${badgeSocInsLabel}
                  </span>
              </div>
              
              <div style="font-size: 10px; color: #999;">ID: ${empId}</div>
            </td>
            
            <td style="vertical-align: middle;">
              <span style="color:#0056b3; font-weight:bold;">${cumulativeHealthBonus.toLocaleString()} 円</span><br>
              <span style="font-size:10px; color:#666;">(上限573万まで残り: ${remainingHealthLimit.toLocaleString()}円)</span>
              ${bonusAlertBadge} 
            </td>
            
            <td style="vertical-align: middle;">
              <input type="number" class="input-bonus" value="${savedBonusWage}" style="width:120px; padding:4px;"> 円
            </td>
            
            <td style="background:#f8f9fa; vertical-align: middle;">
              健保対象: <span class="calc-health-target">0</span> 円<br>
              介護対象: <span class="calc-care-target">0</span> 円<br>
              厚年対象: <span class="calc-pension-target">0</span> 円
            </td>
            
            <td style="background:#fff3cd; padding:8px; min-width:160px; vertical-align: middle;">
              <div style="display:flex; justify-content:space-between; color:#555; font-size:11px;">
                <span>健康保険:</span><span><span class="calc-health-premium">0</span>円</span>
              </div>
              <div style="display:flex; justify-content:space-between; color:#555; font-size:11px;">
                <span>介護保険:</span><span><span class="calc-care-premium">0</span>円</span>
              </div>
              <div style="display:flex; justify-content:space-between; color:#555; font-size:11px;">
                <span>厚生年金:</span><span><span class="calc-pension-premium">0</span>円</span>
              </div>
              <div style="display:flex; justify-content:space-between; color:#856404; font-size:11px; margin-top: 2px;">
                <span>子育て支援金:</span><span><span class="calc-child-support">0</span>円</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-weight:bold; color:#d32f2f; font-size:12px; margin-top:4px; padding-top:4px; border-top:1px dashed #ccc;">
                <span>本人負担 計:</span><span><span class="calc-total-premium">0</span>円</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:10px; color:#888; margin-top:2px;">
                <span>(会社負担 計:</span><span><span class="calc-company-burden">0</span>円)</span>
              </div>
            </td>
            
            <td style="text-align: center; vertical-align: middle;">
              <button class="btn-bonus-indiv-save" style="padding:4px 12px; font-weight:bold; background:#0056b3; color:white; border:none; border-radius:4px; font-size:12px; cursor:pointer;">保存</button>
            </td>
          `;
                tbody.appendChild(tr);
                const bonusInput = tr.querySelector('.input-bonus');
                const healthTargetSpan = tr.querySelector('.calc-health-target');
                const pensionTargetSpan = tr.querySelector('.calc-pension-target');
                const carePremiumSpan = tr.querySelector('.calc-care-premium'); // 👈 介護用を追加！
                const totalPremiumSpan = tr.querySelector('.calc-total-premium'); // 👈 本人合計用を追加！
                const companyBurdenSpan = tr.querySelector('.calc-company-burden'); // 👈 会社負担用を追加！
                const healthPremiumSpan = tr.querySelector('.calc-health-premium');
                const pensionPremiumSpan = tr.querySelector('.calc-pension-premium');
                const indivSaveBtn = tr.querySelector('.btn-bonus-indiv-save');
                // 💡 NEW: 介護対象と子育て支援金の要素を取得
                const careTargetSpan = tr.querySelector('.calc-care-target');
                const childSupportSpan = tr.querySelector('.calc-child-support');
                // 💡 2. リアルタイム計算エンジンの進化版（2026年 法改正＆介護対象対応！）
                const calcBonusPremium = () => {
                    const currentBonus = Number(bonusInput.value) || 0;
                    // 標準賞与額（1000円未満切り捨て）
                    const standardBonus = Math.floor(currentBonus / 1000) * 1000;
                    // 上限ストッパーの判定（竹高さんの元のロジック）
                    const targetHealthBonus = Math.min(standardBonus, remainingHealthLimit);
                    const targetPensionBonus = Math.min(standardBonus, PENSION_BONUS_MAX);
                    // 💡 【重要】ボーナス支給月基準で年齢を計算
                    const paymentDate = new Date(currentPaymentDate);
                    const bonusYear = paymentDate.getFullYear();
                    const bonusMonth = paymentDate.getMonth() + 1;
                    const empAge = calculateAgeForPayroll(emp.birthdate, bonusYear, bonusMonth);
                    // 💡 介護対象の判定と、介護対象額の計算
                    const isNursingTarget = empAge >= 40 && empAge < 65;
                    const targetCareBonus = isNursingTarget ? targetHealthBonus : 0; // 40歳未満は対象額0円！
                    // 💡 3. 各保険料の計算（ハイブリッド型）
                    const hPremium = Math.round(targetHealthBonus * companyRates.healthRateEmp);
                    const pPremium = Math.round(targetPensionBonus * (companyRates.pensionRate / 2));
                    const cPremium = Math.round(targetCareBonus * companyRates.nursingRateEmp);
                    // ==========================================
                    // 💡 NEW: 子育て関連の計算
                    // ==========================================
                    const childSupportEmp = Math.round(targetHealthBonus * (companyRates.childSupportRateEmp || 0));
                    const childSupportComp = Math.round(targetHealthBonus * (companyRates.childSupportRateComp || 0));
                    const childContribution = Math.round(targetPensionBonus * (companyRates.childContributionRate || 0));
                    // 💡 本人負担合計（子育て支援金を追加！）
                    const totalPremium = hPremium + cPremium + pPremium + childSupportEmp;
                    // 会社負担分も別で計算する
                    const hPremiumComp = Math.round(targetHealthBonus * companyRates.healthRateComp);
                    const pPremiumComp = Math.round(targetPensionBonus * (companyRates.pensionRate / 2));
                    const cPremiumComp = Math.round(targetCareBonus * companyRates.nursingRateComp);
                    // 💡 会社負担合計（子育ての会社負担分と、拠出金を追加！）
                    const companyBurden = hPremiumComp + cPremiumComp + pPremiumComp + childSupportComp + childContribution;
                    // ==========================================
                    // 💡 4. 計算結果をHTML（画面）に流し込む！
                    // ==========================================
                    // 対象額の表示更新
                    const healthTargetSpan = tr.querySelector('.calc-health-target'); // 取得漏れ防止でここで直接取得
                    if (healthTargetSpan)
                        healthTargetSpan.innerHTML = targetHealthBonus.toLocaleString();
                    if (careTargetSpan)
                        careTargetSpan.innerHTML = targetCareBonus.toLocaleString();
                    if (pensionTargetSpan)
                        pensionTargetSpan.innerHTML = targetPensionBonus.toLocaleString();
                    // 保険料の表示更新
                    if (healthPremiumSpan)
                        healthPremiumSpan.innerText = hPremium.toLocaleString();
                    if (carePremiumSpan)
                        carePremiumSpan.innerText = cPremium.toLocaleString();
                    if (pensionPremiumSpan)
                        pensionPremiumSpan.innerText = pPremium.toLocaleString();
                    // 💡 NEW: 支援金の表示更新
                    if (childSupportSpan)
                        childSupportSpan.innerText = childSupportEmp.toLocaleString();
                    // 合計の表示更新
                    if (totalPremiumSpan)
                        totalPremiumSpan.innerText = totalPremium.toLocaleString();
                    if (companyBurdenSpan)
                        companyBurdenSpan.innerText = companyBurden.toLocaleString();
                };
                bonusInput.addEventListener('input', calcBonusPremium);
                calcBonusPremium(); // 初期表示時にも1回実行しておく
                // 個別保存
                const saveAction = async () => {
                    indivSaveBtn.innerText = "⏳";
                    try {
                        const recordId = `bonus_${empId}_${currentPaymentDate}`;
                        await setDoc(doc(db, "bonus_payroll_records", recordId), {
                            employeeId: empId, paymentDate: currentPaymentDate,
                            bonusWage: Number(bonusInput.value) || 0,
                            healthTarget: Number(healthTargetSpan.innerText.replace(/,/g, '')),
                            pensionTarget: Number(pensionTargetSpan.innerText.replace(/,/g, '')),
                            updatedAt: new Date()
                        });
                        indivSaveBtn.innerText = "✓";
                        indivSaveBtn.style.background = "#28a745";
                        indivSaveBtn.style.color = "white";
                        setTimeout(() => { indivSaveBtn.innerText = "保存"; indivSaveBtn.style.background = ""; indivSaveBtn.style.color = ""; }, 1500);
                    }
                    catch (e) {
                        indivSaveBtn.innerText = "❌";
                    }
                };
                indivSaveBtn.addEventListener('click', saveAction);
                currentBonusDataList.push({ action: saveAction });
            });
            // ==========================================
            // 🌟 一括保存（絶対に「bonus_payroll_records」に保存する最終決定版！）
            // ==========================================
            const batchSaveBtn = document.getElementById('btn-save-bonus-batch');
            if (batchSaveBtn) {
                batchSaveBtn.onclick = async () => {
                    if (!confirm(`選択された支給日【${currentPaymentDate}】で全員の賞与実績を確定しますか？`))
                        return;
                    batchSaveBtn.disabled = true;
                    const originalText = batchSaveBtn.innerText;
                    batchSaveBtn.innerText = "保存中...";
                    try {
                        const currentCompanyId = localStorage.getItem('current_company_id');
                        if (!currentCompanyId)
                            return;
                        const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                        const usersSnap = await getDocs(usersQuery);
                        const displayIdToRealIdMap = new Map();
                        usersSnap.forEach(d => {
                            const data = d.data();
                            const rawId = String(data.employeeId || data.employeeNumber || d.id).trim();
                            displayIdToRealIdMap.set(rawId, d.id);
                            displayIdToRealIdMap.set(String(Number(rawId)), d.id);
                        });
                        const rows = document.querySelectorAll('#bonus-input-body tr');
                        const batch = writeBatch(db);
                        let saveCount = 0;
                        rows.forEach((row) => {
                            const tr = row;
                            const displayId = tr.getAttribute('data-bonus-emp-id')?.trim();
                            if (!displayId)
                                return;
                            const realDocId = displayIdToRealIdMap.get(displayId) || displayIdToRealIdMap.get(String(Number(displayId)));
                            if (!realDocId)
                                return;
                            const inputEl = tr.querySelector('.input-bonus');
                            if (!inputEl)
                                return;
                            const bonusAmount = Number(inputEl.value) || 0;
                            // 🚨🚨🚨 ここが一番重要！！！ 正しい金庫に保存する！ 🚨🚨🚨
                            const docId = `${realDocId}_${currentPaymentDate}`;
                            const bonusRef = doc(db, 'bonus_payroll_records', docId);
                            batch.set(bonusRef, {
                                companyId: currentCompanyId, // 👈 これが超重要！
                                employeeId: displayId,
                                realDocId: realDocId,
                                paymentDate: currentPaymentDate,
                                bonusWage: bonusAmount,
                                healthTarget: Math.floor(bonusAmount / 1000) * 1000,
                                updatedAt: new Date()
                            }, { merge: true });
                            console.log(`✅ 社員【${displayId}】の ${bonusAmount}円 を bonus_payroll_records に保存準備完了！`);
                            saveCount++;
                        });
                        if (saveCount > 0) {
                            await batch.commit();
                        }
                        alert(`🌟 ${saveCount}名分の賞与履歴の保存が完了し、累計額が再集計されました！`);
                        // タスク生成
                        if (currentPaymentDate) {
                            const taskKey = `hr_tasks_${currentCompanyId}`;
                            const savedTasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
                            const taskTitle = `【重要】${currentPaymentDate}支給分 賞与支払届の作成および提出`;
                            const exists = savedTasks.some((t) => t.title === taskTitle);
                            if (!exists) {
                                const deadlineDate = new Date(new Date(currentPaymentDate).getTime() + 5 * 24 * 60 * 60 * 1000);
                                const deadlineStr = deadlineDate.toISOString().split('T')[0];
                                const newTask = {
                                    id: Date.now(),
                                    title: taskTitle,
                                    empName: "支給対象者",
                                    agency: '年金事務所',
                                    status: 'todo',
                                    deadline: deadlineStr,
                                    source: '自動検知(賞与)',
                                    createdAt: new Date().toISOString(),
                                    memo: `${currentPaymentDate} 支給分の賞与支払届を作成し、e-Govから年金事務所へ提出してください。\n（※提出期限：支給日から5日以内）`,
                                    targetPaymentDate: currentPaymentDate
                                };
                                savedTasks.push(newTask);
                                localStorage.setItem(taskKey, JSON.stringify(savedTasks));
                            }
                        }
                        loadBonusData();
                    }
                    catch (error) {
                        console.error("❌ 保存エラー発生:", error);
                        alert("エラーが発生しました。");
                    }
                    finally {
                        batchSaveBtn.disabled = false;
                        batchSaveBtn.innerText = originalText;
                    }
                };
            }
            // e-Gov用 CSV出力機能（賞与）
            // // e-Gov用 CSV出力機能（最強エンジン呼び出し版）
            const exportBtn = document.getElementById('btn-export-egov-bonus');
            if (exportBtn) {
                // 竹高さんお手製の完璧なゴースト対策！
                const newExportBtn = exportBtn.cloneNode(true);
                exportBtn.parentNode?.replaceChild(newExportBtn, exportBtn);
                newExportBtn.addEventListener('click', () => {
                    // すでに取得済みの currentPaymentDate（例: '2026-06-15'）を使用
                    if (!currentPaymentDate) {
                        alert("賞与支給日を選択してください。");
                        return;
                    }
                    // 一番下に作った最強の賞与CSVエンジンを起動！
                    if (typeof downloadShoyoCSV === 'function') {
                        downloadShoyoCSV(currentPaymentDate);
                    }
                    else {
                        window.downloadShoyoCSV(currentPaymentDate);
                    }
                });
            }
        }
        catch (error) {
            console.error("賞与エラー:", error);
        }
    };
    // 🔍 リアルタイム社員検索の制御ロジック（賞与タブ用）
    const searchBonusEmp = document.getElementById('search-bonus-emp');
    if (searchBonusEmp) {
        searchBonusEmp.addEventListener('input', (e) => {
            // 1. 全角を半角にし、空白を消す
            const searchTerm = e.target.value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
            // 🚨👇 【重要】賞与タブの tbody の ID（おそらく #bonus-input-body や #bonus-list-body）に合わせてください！
            const rows = document.querySelectorAll('#bonus-input-body tr');
            rows.forEach((row) => {
                const tr = row;
                // 読み込み中などのシステム行は無視
                if (tr.cells.length < 2)
                    return;
                // 2. 1番左の列(cells[0])の文字だけを取得して空白を消す！
                const rowText = (tr.cells[0]?.innerText || "").normalize('NFKC').toLowerCase().replace(/\s+/g, '');
                if (rowText.includes(searchTerm)) {
                    tr.style.display = '';
                }
                else {
                    tr.style.display = 'none';
                }
            });
        });
    }
    // 💡 修正2：「賞与支払届」のサブタブがクリックされたら、毎回最新データで画面を再構築する！
    const bonusTabBtn = document.querySelector('[data-sub-target="payroll-bonus"]');
    if (bonusTabBtn) {
        bonusTabBtn.addEventListener('click', () => {
            loadBonusData();
        });
    }
    // カレンダーの値変更イベント
    paymentDateInput.removeEventListener('change', loadBonusData);
    paymentDateInput.addEventListener('change', loadBonusData);
    // 初回データ読み込み
    loadBonusData();
    // ==========================================
    // 📁 賞与用 CSVインポートエンジン
    // ==========================================
    const csvBtn = document.getElementById('btn-bonus-csv-import');
    const csvInput = document.getElementById('bonus-csv-upload');
    if (csvBtn && csvInput) {
        // 🌟 ボタンが押されたら裏側のinputをクリック（onclickで上書き！）
        csvBtn.onclick = () => csvInput.click();
        // 🌟 ファイルが選択された時の処理（onchangeで「常に1つ」に上書き！）
        csvInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result;
                const lines = text.split('\n');
                let successCount = 0;
                for (let i = 1; i < lines.length; i++) {
                    const currentLine = lines[i];
                    if (!currentLine || !currentLine.trim())
                        continue;
                    const cols = currentLine.split(',');
                    if (cols.length >= 2) {
                        const targetId = cols[0]?.trim();
                        const bonusAmt = cols[1]?.trim();
                        if (!targetId)
                            continue;
                        const targetRow = document.querySelector(`tr[data-bonus-emp-id="${targetId}"]`);
                        if (targetRow) {
                            const bonusInput = targetRow.querySelector('.input-bonus');
                            bonusInput.value = bonusAmt || "0";
                            bonusInput.dispatchEvent(new Event('input'));
                            successCount++;
                        }
                    }
                }
                // ここは何度画面を切り替えても、確実に1回だけしか出なくなります！
                alert(`✅ 賞与CSVの読み込み完了！\n${successCount}名分の賞与データを自動入力しました。\n「一括保存」を押して確定させてください。`);
                // 次も同じファイルを選べるようにリセット
                csvInput.value = "";
            };
            reader.readAsText(file, 'Shift_JIS');
        };
    }
    // 🌟 修正：ここで関数を実行して、画面を出す！
    loadBonusData();
    initSalaryFilterUI('btn-bonus-active', 'btn-bonus-retired', 'bonus-emp-filter', 'bonus', loadBonusData);
}
// ==========================================
// 🏢 算定基礎（年次処理）のFirebase実データ連動ロジック
// ==========================================
// 💡 asyncをつけて、Firebaseの通信を待てるようにします
async function initSanteiUI() {
    const tbody = document.getElementById('santei-list-body');
    if (!tbody)
        return;
    // 🌟🌟🌟 ① ここから箱（関数）を作り始める！ 🌟🌟🌟
    const loadSanteiData = async () => {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: #666;">🔄 Firebaseから4月〜6月の給与実績を読み込み中...</td></tr>`;
        try {
            // 1️⃣ Firebaseから「従業員マスタ(users)」をごっそり取得
            // Firebaseから「従業員マスタ(users)」をごっそり取得
            const currentCompanyId = localStorage.getItem('current_company_id');
            if (!currentCompanyId)
                return;
            // 🌟 usersコレクションにフィルター
            const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
            const usersSnapshot = await getDocs(usersQuery);
            const employees = [];
            const currentFilter = localStorage.getItem('santei_status') || 'active';
            const currentTypeFilter = localStorage.getItem('santei_type') || 'all';
            usersSnapshot.forEach((doc) => {
                // 🌟 usersSnapshot.forEach(...) が終わった直後にこれを貼り付ける！
                console.log("👀 今のフィルター状態:", currentFilter);
                console.log("👥 フィルター通過した人数:", employees.length, "人", employees);
                const data = doc.data();
                // 🌟 フィルター処理：条件に合わない人は配列に入れない（弾く）
                if (currentFilter === 'active' && data.employeeStatus !== 'active')
                    return;
                if (currentFilter === 'retired' && data.employeeStatus !== 'retired')
                    return;
                // =========================================================
                // 🌟🌟🌟 【ここに追加！！】区分（社保区分）のフィルター 🌟🌟🌟
                // =========================================================
                const socInsType = data.socialInsuranceType || 'regular';
                if (currentTypeFilter !== 'all') {
                    // 画面のプルダウンの値と一致しない人は弾く！
                    if (socInsType !== currentTypeFilter)
                        return;
                }
                // =========================================================
                employees.push({ id: doc.id, ...data });
            });
            // 2️⃣ Firebaseから「毎月の給与実績(monthly_payroll_records)」をごっそり取得
            const payrollQuery = query(collection(db, "monthly_payroll_records"), where("companyId", "==", currentCompanyId));
            const payrollSnapshot = await getDocs(payrollQuery);
            const payrollRecords = [];
            payrollSnapshot.forEach((doc) => payrollRecords.push(doc.data()));
            // 👇＝＝＝ ここに追加！ ＝＝＝👇
            // 🌟 Firebaseから「賞与実績(bonus_payroll_records)」もごっそり取得
            // 🌟 bonus_payroll_recordsコレクションにもフィルター！
            // 🌟🌟🌟 新しい読み込み処理（サブコレクション対応版） 🌟🌟🌟
            // 🌟 算定基礎の中にある賞与読み込みを元に戻す！
            const bonusQuery = query(collection(db, "bonus_payroll_records"), where("companyId", "==", currentCompanyId));
            const bonusSnapshot = await getDocs(bonusQuery);
            const allBonusRecords = [];
            bonusSnapshot.forEach((doc) => allBonusRecords.push(doc.data()));
            // 🌟🌟🌟 ここまで 🌟🌟🌟
            // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
            tbody.innerHTML = '';
            if (employees.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">従業員が登録されていません。</td></tr>`;
                return;
            }
            // 💡 画面に表示する用の確定した算定結果を溜める配列（後で一括保存に使う）
            const finalSanteiBatchList = [];
            // =========================================================
            // 🌟🌟🌟 【ここに追加！】ループで画面を作る前に、従業員をID順に並び替える 🌟🌟🌟
            // =========================================================
            employees.sort((a, b) => {
                // IDを取得（もし employeeId が無ければ id を使う安全設計）
                const idA = String(a.employeeId || a.employeeNumber || a.id || "");
                const idB = String(b.employeeId || b.employeeNumber || b.id || "");
                // localeCompareの { numeric: true } で「00001」と「000010」を人間と同じように正しく並び替える最強メソッド！
                return idA.localeCompare(idB, undefined, { numeric: true });
            });
            // =========================================================
            // 3️⃣ 従業員ごとに4・5・6月のデータを紐付けて法律計算を走らせる（完全自動・ノイズキャンセル版！）
            employees.forEach((emp) => {
                const lastName = emp.lastNameKanji || "";
                const firstName = emp.firstNameKanji || "";
                const empName = (lastName || firstName) ? `${lastName} ${firstName}`.trim() : "名称未設定";
                const empId = emp.employeeId || emp.employeeNumber || emp.id;
                const empType = emp.contractInfo?.empType || "未設定";
                const currentGrade = emp.healthGrade || 1;
                const aprData = payrollRecords.find(r => String(r.employeeId) === String(empId) && Number(r.year) === 2026 && Number(r.month) === 4) || { totalWage: 0, days: 0, adjustmentAmount: 0, adjustmentReason: "" };
                const mayData = payrollRecords.find(r => String(r.employeeId) === String(empId) && Number(r.year) === 2026 && Number(r.month) === 5) || { totalWage: 0, days: 0, adjustmentAmount: 0, adjustmentReason: "" };
                const junData = payrollRecords.find(r => String(r.employeeId) === String(empId) && Number(r.year) === 2026 && Number(r.month) === 6) || { totalWage: 0, days: 0, adjustmentAmount: 0, adjustmentReason: "" };
                // 👇＝＝＝ ここから追加（年4回特例の判定） ＝＝＝👇
                const santeiYear = 2026; // ※処理する年
                const periodStart = `${santeiYear - 1}-07-01`;
                const periodEnd = `${santeiYear}-06-30`;
                // 🌟🌟🌟 算定基礎用「絶対見つけるマン」にアップデート！ 🌟🌟🌟
                const safeEmpId = String(emp.employeeId || emp.employeeNumber || emp.id).trim();
                const safeRealId = String(emp.id).trim();
                const empBonuses = allBonusRecords.filter(b => {
                    const rEmpId = String(b.employeeId || "").trim();
                    const rRealId = String(b.realDocId || "").trim();
                    // 画面のIDか、本当のIDのどちらかが一致すればOK！
                    const isMatch = (rEmpId === safeEmpId || rRealId === safeRealId);
                    return isMatch && b.paymentDate >= periodStart && b.paymentDate <= periodEnd;
                });
                // 🕵️‍♂️ 監視カメラ（F12コンソール用：ちゃんと見つかったか確認！）
                if (empBonuses.length > 0) {
                    console.log(`🎉 社員【${safeEmpId}】の対象賞与を ${empBonuses.length}件 発見！`, empBonuses);
                }
                let monthlyBonusAddition = 0;
                if (empBonuses.length >= 4) {
                    const totalBonus = empBonuses.reduce((sum, b) => sum + Number(b.bonusWage || 0), 0);
                    monthlyBonusAddition = Math.floor(totalBonus / 12); // 千円未満切り捨て前に12ヶ月で割る
                    console.log(`🔥 年4回特例発動！ 月額に ${monthlyBonusAddition}円 加算します！`);
                }
                // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
                // =========================================================
                // 🌟🌟🌟 ハイブリッド判定 ＆ ノイズキャンセル融合エンジン 🌟🌟🌟
                // =========================================================
                const socInsType = emp.socialInsuranceType || 'regular';
                const joinDateStr = emp.contractInfo?.startDate || emp.startDate;
                // 💡 途中入社月（2日以降の入社）を判定する関数
                const isMidMonthJoin = (targetMonth) => {
                    if (!joinDateStr)
                        return false;
                    const joinDate = new Date(joinDateStr);
                    if (joinDate.getMonth() + 1 === targetMonth && joinDate.getDate() > 1)
                        return true;
                    return false;
                };
                // 💡 この従業員の「必要基礎日数（しきい値）」を算出する！
                let employeeThreshold = 17; // 基本は17日
                if (socInsType === 'short_time') {
                    employeeThreshold = 11; // 短時間労働者は11日
                }
                else if (socInsType === 'part_time') {
                    // パート（15日基準）は「4,5,6月のうち17日以上の月が1つでもあるか？」をチェック
                    const daysArray = [Number(aprData.days) || 0, Number(mayData.days) || 0, Number(junData.days) || 0];
                    const has17 = daysArray.some(d => d >= 17);
                    employeeThreshold = has17 ? 17 : 15; // 17日があれば17、無ければ15になる！
                }
                let validWages = [];
                // 🌟 竹高さんオリジナルのノイズキャンセル関数（ハイブリッド対応版！）
                const formatMonthCell = (data, monthNum, bonusAdd = 0) => {
                    if (!data || (Number(data.totalWage) === 0 && Number(data.days) === 0)) {
                        return `<span style="color:#999;">データなし（入社前月）</span>`;
                    }
                    let wage = Number(data.totalWage);
                    const adjAmount = Number(data.adjustmentAmount || 0);
                    const reason = data.adjustmentReason;
                    // 🚨 【NEW】途中入社の月なら即除外！
                    if (isMidMonthJoin(monthNum)) {
                        return `
                  <span style="color:#dc3545; text-decoration: line-through;">${wage.toLocaleString()}円<br>(${data.days}日)</span><br>
                  <span style="font-size:10px; color:#dc3545; font-weight:bold;">⚠️ 途中入社月のため除外</span>
              `;
                    }
                    // 🚨 ノイズ除外フラグがある場合は即除外！
                    if (reason === "miharai_now" || reason === "kyushoku") {
                        const reasonText = reason === "miharai_now" ? "未払い/遅配" : "休職等";
                        return `
                  <span style="color:#dc3545; text-decoration: line-through;">${wage.toLocaleString()}円</span><br>
                  <span style="font-size:10px; color:#dc3545; font-weight:bold;">⚠️ ${reasonText}で算定除外</span>
              `;
                    }
                    let displayAdjustText = "";
                    // 💡 遡及・遅配のフラグがあれば「自動引き算」をして本来の給与額に戻す！（ノイズキャンセル）
                    if (reason === "sokyu" || reason === "chihai_past") {
                        wage = wage - adjAmount;
                        if (adjAmount !== 0) {
                            const sign = adjAmount > 0 ? '-' : '+';
                            const reasonText = reason === "sokyu" ? "遡及分除外" : "過去遅配分を除外";
                            displayAdjustText = `<br><span style="font-size:10px; color:#0056b3;">(${reasonText}: ${sign}${Math.abs(adjAmount).toLocaleString()}円)</span>`;
                        }
                    }
                    // 👇＝＝＝ ここに追加！ ＝＝＝👇
                    // 💡 年4回賞与特例の加算 ＆ 画面UIへの表示！
                    if (bonusAdd > 0) {
                        wage = wage + bonusAdd; // 給与に上乗せ！
                        displayAdjustText += `<br><span style="font-size:11px; color:#e65100; font-weight:bold;">⚠️ 年4回賞与特例 (+${bonusAdd.toLocaleString()}円)</span>`;
                    }
                    // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
                    // 💡 ハイブリッド判定で算出した `employeeThreshold` で日数チェック！
                    if (Number(data.days) >= employeeThreshold) {
                        validWages.push(wage); // 🌟 ノイズキャンセル済みの綺麗な給与を計算用配列へ！
                        return `<span>${wage.toLocaleString()}円<br>(${data.days}日)</span>${displayAdjustText}`;
                    }
                    else {
                        return `
                  <span style="color:#dc3545; text-decoration: line-through;">${wage.toLocaleString()}円<br>(${data.days}日)</span><br>
                  <span style="font-size:10px; color:#dc3545; font-weight:bold;">⚠️ 日数不足(${employeeThreshold}日未満)で除外</span>
              `;
                    }
                };
                // 🌟 呼び出し時に monthlyBonusAddition を渡す！
                const aprHtml = formatMonthCell(aprData, 4, monthlyBonusAddition);
                const mayHtml = formatMonthCell(mayData, 5, monthlyBonusAddition);
                const junHtml = formatMonthCell(junData, 6, monthlyBonusAddition);
                // 有効な月だけで平均額を算出
                const averageWage = validWages.length > 0 ? Math.round(validWages.reduce((sum, w) => sum + w, 0) / validWages.length) : 0;
                // 🌟 NEW: データが空っぽの時の「分岐」を追加！
                let resultHtml = "";
                let statusBadge = "";
                let exportData = null;
                if (validWages.length === 0) {
                    // 🚨 データが足りない場合は「現状維持（対象外）」として扱う
                    resultHtml = `
      <span style="font-size:11px; color:#666;">現: ${currentGrade}等級</span><br>
      <strong style="color:#6c757d; font-size:14px;">新: - (現等級を維持)</strong>
  `;
                    // バッジもエラーっぽさを消し、明確に「算定対象外」と表示
                    statusBadge = `<span style="padding:4px 8px; background:#e2e3e5; color:#383d41; border: 1px solid #d6d8db; border-radius:4px; font-size:11px; font-weight:bold;">算定対象外</span>`;
                }
                else {
                    // 🟢 正常に計算できた場合（1ヶ月以上データがある）
                    const newInsurance = calculateSocialInsurance(averageWage);
                    resultHtml = `
        <span style="font-size:11px; color:#666;">現: ${currentGrade}等級</span><br>
        <strong style="color:#d32f2f; font-size:14px;">新: ${newInsurance.healthGrade}等級</strong>
    `;
                    statusBadge = `<span style="padding:4px 8px; background:#28a745; color:white; border-radius:4px; font-size:11px; font-weight:bold;">自動計算済 ✓</span>`;
                    // 保存リスト（exportData）を作るのは、計算ができた人だけ！
                    exportData = {
                        empDocId: emp.id,
                        empId: empId,
                        empName: empName,
                        monthlyBonusAddition: monthlyBonusAddition,
                        newHealthGrade: newInsurance.healthGrade,
                        newPensionGrade: newInsurance.pensionGrade,
                        aprData: aprData,
                        mayData: mayData,
                        junData: junData,
                        averageWage: averageWage,
                        totalSum: validWages.reduce((sum, w) => sum + w, 0),
                        empType: empType,
                        adjustmentState: {
                            4: { reason: aprData.adjustmentReason },
                            5: { reason: mayData.adjustmentReason },
                            6: { reason: junData.adjustmentReason }
                        }
                    };
                }
                // 🎨 テーブル行を生成
                // ==========================================
                // 🌟 UI改善：社保区分のバッジ作成ロジック（算定基礎用）
                // ==========================================
                // 💡 ループ内のデータ変数（emp や res, cloudData など）に合わせて、
                // 「emp.socialInsuranceType」の部分は適宜書き換えてください！
                let santeiBadgeLabel = "一般";
                let santeiBadgeBg = "#d1fae5"; // 背景：薄い緑
                let santeiBadgeText = "#065f46"; // 文字：濃い緑
                if (emp.socialInsuranceType === "short_time") {
                    santeiBadgeLabel = "短時間";
                    santeiBadgeBg = "#fef08a"; // 背景：薄い黄
                    santeiBadgeText = "#854d0e"; // 文字：濃い黄
                }
                else if (emp.socialInsuranceType === "part_time") {
                    santeiBadgeLabel = "パート";
                    santeiBadgeBg = "#ffedd5"; // 背景：薄いオレンジ
                    santeiBadgeText = "#9a3412"; // 文字：濃いオレンジ
                }
                else if (emp.socialInsuranceType === "none") {
                    santeiBadgeLabel = "未加入";
                    santeiBadgeBg = "#f3f4f6"; // 背景：薄いグレー
                    santeiBadgeText = "#374151"; // 文字：濃いグレー
                }
                const badgeStyle = "display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: bold; border-radius: 4px; margin-right: 4px;";
                // 💡 ここから tr の作成！
                const tr = document.createElement('tr');
                tr.innerHTML = `
    <td style="vertical-align: top; padding: 12px; border-bottom: 1px solid #dee2e6;">
        <strong style="font-size: 14px; color: #333; display: block; margin-bottom: 4px;">${empName}</strong>
        
        <div style="margin-bottom: 4px;">
            <span style="${badgeStyle} background-color: #e0f2fe; color: #075985;">
                ${empType}
            </span>
            <span style="${badgeStyle} background-color: ${santeiBadgeBg}; color: ${santeiBadgeText};">
                ${santeiBadgeLabel}
            </span>
        </div>
        
        <div style="font-size: 10px; color: #999;">ID: ${empId}</div>
    </td>
    
    <td style="background:#f8f9fa; padding: 12px; vertical-align: middle; border-bottom: 1px solid #dee2e6;">${aprHtml}</td>
    <td style="background:#f8f9fa; padding: 12px; vertical-align: middle; border-bottom: 1px solid #dee2e6;">${mayHtml}</td>
    <td style="background:#f8f9fa; padding: 12px; vertical-align: middle; border-bottom: 1px solid #dee2e6;">${junHtml}</td>
    
    <td style="font-weight:bold; color:#0056b3; background:#e3f2fd; padding: 12px; vertical-align: middle; border-bottom: 1px solid #dee2e6;">
        ${averageWage.toLocaleString()} 円<br>
        <span style="font-size:10px; color:#666;">(${validWages.length}ヶ月平均)</span>
    </td>
    
    <td style="background:#fff3cd; padding: 12px; vertical-align: middle; border-bottom: 1px solid #dee2e6;">
        ${resultHtml}
    </td>
    
    <td style="text-align: center; padding: 12px; vertical-align: middle; border-bottom: 1px solid #dee2e6;">
        ${statusBadge}
    </td>
`;
                tbody.appendChild(tr);
                // 💾 e-Gov用の一括出力リストにデータを突っ込む（計算できた人だけ！）
                if (exportData) {
                    const existingIndex = finalSanteiBatchList.findIndex(item => item.empDocId === emp.id);
                    if (existingIndex >= 0) {
                        finalSanteiBatchList[existingIndex] = exportData;
                    }
                    else {
                        finalSanteiBatchList.push(exportData);
                    }
                }
            });
            // 🔍 リアルタイム社員検索の制御ロジック（算定基礎タブ用）
            const searchSanteiEmp = document.getElementById('search-santei-emp');
            if (searchSanteiEmp) {
                searchSanteiEmp.addEventListener('input', (e) => {
                    // 💡 1. 検索ワード（入力）の全角を半角にし、小文字化し、空白を消す！
                    const searchTerm = e.target.value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
                    // 🚨👇 【重要】実際の算定タブのテーブルの tbody の ID に合わせてください！
                    // （例: '#santei-input-body tr' や '#santei-table-body tr' など）
                    const rows = document.querySelectorAll('#santei-list-body tr');
                    rows.forEach((row) => {
                        const tr = row;
                        // 読み込み中などのシステム行は無視
                        if (tr.cells.length < 2)
                            return;
                        // 💡 2. 表の文字（データ）も全角を半角にし、小文字化し、空白を消す！
                        const rowText = (tr.cells[0]?.innerText || "").normalize('NFKC').toLowerCase().replace(/\s+/g, '');
                        if (rowText.includes(searchTerm)) {
                            tr.style.display = '';
                        }
                        else {
                            tr.style.display = 'none';
                        }
                    });
                });
            }
            // 🌟 プルダウンの選択に応じて、金額や本来の月の入力をロック/解除する関数
            window.handleAdjustmentChange = function (empId) {
                const reasonSelect = document.getElementById(`adj-reason-${empId}`);
                const originMonthSelect = document.getElementById(`adj-origin-month-${empId}`);
                const amountInput = document.getElementById(`adj-amount-${empId}`);
                if (!reasonSelect || !originMonthSelect || !amountInput)
                    return;
                const reason = reasonSelect.value;
                // 💡 「当月未払い」か「休職等」が選ばれたら、月ごと除外するので金額・本来の月は不要！
                if (reason === 'miharai_now' || reason === 'kyushoku') {
                    amountInput.value = '';
                    amountInput.disabled = true;
                    amountInput.style.backgroundColor = '#e9ecef';
                    amountInput.placeholder = "入力不要（除外）";
                    originMonthSelect.value = '';
                    originMonthSelect.disabled = true;
                    originMonthSelect.style.backgroundColor = '#e9ecef';
                }
                else {
                    // 💡 遡及や過去の遅配など、金額を引く場合は入力可能に戻す
                    amountInput.disabled = false;
                    amountInput.style.backgroundColor = '#ffffff';
                    amountInput.placeholder = "例: -50000";
                    originMonthSelect.disabled = false;
                    originMonthSelect.style.backgroundColor = '#ffffff';
                }
            };
            // ==========================================
            // 💾 【ステップ①への繋ぎ込み】新等級の自動予約システム
            // ==========================================
            const saveBtn = document.getElementById('btn-save-santei');
            // 古いイベントリスナーが重複しないように一度ボタンをクローンして初期化
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode?.replaceChild(newSaveBtn, saveBtn);
            newSaveBtn.addEventListener('click', async () => {
                if (!confirm("全員の新等級（9月適用分）をデータベースに予約保存しますか？\n8月までの過去画面は維持され、9月分になった瞬間に自動切り替えされます。"))
                    return;
                newSaveBtn.disabled = true;
                newSaveBtn.innerText = "⏳ 等級予約を書き込み中...";
                try {
                    // 全員の予約データをFirebaseのusersコレクションに「予約フィールド」として書き込む
                    for (const res of finalSanteiBatchList) {
                        await setDoc(doc(db, "users", res.empDocId), {
                            // ❌ healthGrade を直接上書きするのをやめて、未来の予約チケットにする！
                            santeiNextHealthGrade: res.newHealthGrade,
                            santeiNextPensionGrade: res.newPensionGrade,
                            santeiApplyYear: 2026, // 適用する年
                            santeiApplyMonth: 9, // 適用する月
                            santeiReservedAt: new Date(),
                            santeiStatus: "9月適用予約済",
                            santeiAdjustment2026: res.adjustmentState
                        }, { merge: true });
                    }
                    alert("🎯 算定基礎の「9月自動適用予約」が完了しました！\n（マスタへ予約チケットを安全に書き込みました。過去の履歴は保護されています）");
                    // 画面をリロード
                    location.reload();
                }
                catch (e) {
                    console.error(e);
                    alert("予約保存に失敗しました。");
                }
                finally {
                    newSaveBtn.disabled = false;
                    newSaveBtn.innerText = "💾 全員の新等級をDBに保存(9月適用)";
                }
            });
            // ==========================================
            // 📥 算定基礎届の e-Gov用 CSV出力機能
            // ==========================================
            const exportBtn = document.getElementById('btn-export-santei-csv');
            const newExportBtn = exportBtn?.cloneNode(true);
            exportBtn?.parentNode?.replaceChild(newExportBtn, exportBtn);
            newExportBtn?.addEventListener('click', async () => {
                if (finalSanteiBatchList.length === 0) {
                    alert('出力するデータがありません。');
                    return;
                }
                try {
                    // 🌟 0. 会社IDを取得して防壁を張る！
                    const currentCompanyId = localStorage.getItem('current_company_id');
                    if (!currentCompanyId) {
                        alert("会社情報が読み込めません。");
                        return;
                    }
                    // 🌟 1. 【修正】会社情報を「自社専用の箱」から取得！
                    let companyMaster = {};
                    const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
                    if (docSnap.exists()) {
                        companyMaster = docSnap.data();
                    }
                    else {
                        alert("⚠️ 会社情報が設定されていません。「法定料率・マスター」タブで保存してください。");
                        return;
                    }
                    // 🚫 【削除完了】危険なローカルストレージ（hr_employee_master）の呼び出しは消去しました！
                    // 🌟 2. 【超重要】必ず「自社」の従業員だけで絞り込んで取得！！！
                    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
                    const usersSnap = await getDocs(usersQuery);
                    const firestoreUsersMap = {};
                    usersSnap.forEach((d) => {
                        const data = d.data();
                        const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
                        firestoreUsersMap[fullName] = data;
                        firestoreUsersMap[fullName.replace(/\s+/g, '')] = data;
                    });
                    // メタデータと和暦エンジン
                    const csvMeta = {
                        mediaSeq: "001",
                        creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
                        repCode: "22157" // 🔥 修正：「22223(賞与)」から「22157(算定基礎)」に変更！
                    };
                    const getEgoveDate = (dateStr) => {
                        if (!dateStr)
                            return { gengo: "", date: "" };
                        const d = new Date(dateStr);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        if (y >= 2019)
                            return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
                        if (y >= 1989)
                            return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
                        return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
                    };
                    // ==========================================
                    // 🌟 会社情報の最強抽出エンジン（算定基礎にも搭載！）
                    // ==========================================
                    const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
                    const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
                    const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
                    const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
                    const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
                    // 郵便番号のハイフン分割
                    const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
                    const zipSplit = rawZip.split('-');
                    const zip1 = zipSplit[0] || "";
                    const zip2 = zipSplit[1] || "";
                    // 電話番号のハイフン分割
                    const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
                    const telSplit = rawTel.split('-');
                    const tel1 = telSplit[0] || "";
                    const tel2 = telSplit[1] || "";
                    const tel3 = telSplit[2] || "";
                    // 会社名と代表者名
                    const compName = companyMaster.companyName || companyMaster.name || "";
                    const repName = companyMaster.employerName || companyMaster.representativeName || "";
                    // ==========================================
                    // 🌟 管理レコード（[kanri] ブロック）生成
                    // ==========================================
                    let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
                    csvContent += "[kanri]\n,001\n";
                    csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
                    csvContent += "[data]\n";
                    // 適用年月（算定基礎なので通常は本年の「9月」固定）
                    const applyYear = new Date().getFullYear();
                    const applyEgove = getEgoveDate(`${applyYear}-09-01`);
                    // 🌟 データレコード（全54項目の配列生成ループ）
                    // 🌟 消えちゃっていた「ループの始まり」を復活！
                    finalSanteiBatchList.forEach(res => {
                        const targetEmpName = res.empName.trim();
                        // 🚫 危険なローカルデータ（localMasterDB）は消去したので、安全なクラウド（cloudData）だけを取得！
                        const cloudData = firestoreUsersMap[targetEmpName] || firestoreUsersMap[targetEmpName.replace(/\s+/g, '')] || {};
                        // 🌟 localData への参照をすべて削除して、cloudData に一本化！
                        const empId = res.empId || cloudData.employeeId || "";
                        const kanji = targetEmpName;
                        const kana = cloudData.lastNameKana ? `${cloudData.lastNameKana} ${cloudData.firstNameKana}`.trim() : "";
                        const myNumber = cloudData.myNumber || "";
                        const pensionNum = cloudData.basicPensionNumber || cloudData.pensionNumber || "";
                        // 🌟 2つ目の修正：getEgovDate ではなく getEgoveDate（eを入れる）にする！
                        // 🔥 さらに修正：birthdate(小文字)とbirthDate(大文字)の両方を探す！
                        const rawDob = cloudData.birthdate || cloudData.birthDate || "";
                        const birthEGov = getEgoveDate(rawDob);
                        // Step 1 で持たせた月ごとの給与データを展開
                        const apr = res.aprData || { days: 0, totalWage: 0 };
                        const may = res.mayData || { days: 0, totalWage: 0 };
                        const jun = res.junData || { days: 0, totalWage: 0 };
                        // 🌟 ここも localData を削除！
                        const socInsType = cloudData.socialInsuranceType || "regular";
                        let shortTimeFlag = ""; // 項番49 (短時間労働者 11日基準)
                        let partTimeFlag = ""; // 項番50 (パートタイマー 15日基準)
                        if (socInsType === "short_time") {
                            shortTimeFlag = "1";
                        }
                        else if (socInsType === "part_time") {
                            partTimeFlag = "1";
                        }
                        // 🌟 1. 調整データから、CSVの専用カラム・備考欄に埋め込む値を抽出する
                        let sokyuMonth = "";
                        let sokyuAmount = "";
                        let bikoText = "";
                        // 保存しておいた adjustmentState をループで解析
                        if (res.adjustmentState) {
                            Object.entries(res.adjustmentState).forEach(([month, data]) => {
                                if (data.reason === "sokyu") {
                                    // 遡及適用の場合：項番20・21に入れる「月」と「金額」をセット
                                    sokyuMonth = month.padStart(2, '0'); // 例: "4" -> "04"
                                    sokyuAmount = Math.abs(data.amount).toString(); // 金額を文字列化（マイナス記号は取って絶対値にする）
                                }
                                else if (data.reason === "miharai_now") {
                                    // 当月未払いの場合：項番52の「備考欄」に出力するテキストを組み立てる
                                    bikoText += `${month}月分給与未払いのため算定対象から除外 `;
                                }
                                // ※遅配（chihai_past）の場合は、金額の計算にだけ使い、備考欄等には何も出さないのが正解です
                            });
                            bikoText = bikoText.trim(); // 余分な空白を消す
                        }
                        // 🌟 2. 仕様書完全準拠・自動反映版の配列
                        const row = [
                            "2215700", // 1. 様式コード (算定基礎届)
                            companyMaster.prefCode || "", // 2. 都道府県コード
                            companyMaster.cityCode || "", // 3. 郡市区符号
                            companyMaster.officeSymbol || "", // 4. 事業所記号
                            companyMaster.officeNumber || "", // 5. 事業所番号
                            empId, // 6. 被保険者整理番号
                            kana, // 7. 氏名カナ
                            kanji, // 8. 氏名漢字
                            birthEGov.gengo, // 9. 生年月日_元号
                            birthEGov.date, // 10. 生年月日_年月日
                            applyEgove.gengo, // 11. 適用年月_元号
                            applyEgove.date.substring(0, 2), // 12. 適用年月_年
                            "09", // 13. 適用年月_月（9月固定）
                            "", "", // 14, 15. 従前の標準報酬月額（健保・厚年）
                            "", "", "", // 16-18. 従前の改定年月
                            "", // 19. 昇（降）給区分（通常空欄）
                            sokyuMonth, // 20. 遡及支払月 ✨（ここが自動で "04" などになる！）
                            sokyuAmount, // 21. 遡及支払額 ✨（ここが自動で "50000" などになる！）
                            "04", "05", "06", // 22-24. 給与支給月 (4, 5, 6月)
                            apr.days, may.days, jun.days, // 25-27. 基礎日数
                            apr.totalWage, may.totalWage, jun.totalWage, // 28-30. 通貨による額
                            "0", "0", "0", // 31-33. 現物による額
                            apr.totalWage, may.totalWage, jun.totalWage, // 34-36. 合計額
                            res.totalSum, // 37. 総計
                            res.averageWage, // 38. 平均額
                            "", // 39. 修正平均額
                            myNumber, // 40. 個人番号
                            "", // 41. 課所符号
                            pensionNum, // 42. 基礎年金番号
                            // 👇＝＝＝ e-Gov完全準拠（全53項目）に修正！ ＝＝＝👇
                            "", // 43. 備考欄項目1 (70歳以上被用者等)
                            "", // 44. 70歳算定基礎月 (※ここが抜けていました！)
                            "", // 45. 備考欄項目2 (二以上事業所等)
                            "", // 46. 備考欄項目3 (月額変更予定等)
                            "", // 47. 備考欄項目4 (給与支払対象等)
                            "", // 48. 備考欄項目5 (病休・育休等)
                            shortTimeFlag, // 49. 備考欄項目6 ✨ (短時間労働者フラグ: 11日)
                            partTimeFlag, // 50. 備考欄項目7 ✨ (パートタイマーフラグ: 15日)
                            "", // 51. 備考欄項目8 (年間平均等)
                            bikoText, // 52. 備考欄 (フリーテキスト) 未払い理由などが自動で入る！
                            "" // 53. 70歳以上使用者の申出
                        ];
                        csvContent += row.join(",") + "\n";
                    });
                    // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！
                    // 1. まず文字列を文字コードの配列に変換
                    const unicodeArray = Encoding.stringToCode(csvContent);
                    // 2. UNICODE から SJIS に変換
                    const sjisArray = Encoding.convert(unicodeArray, {
                        to: 'SJIS',
                        from: 'UNICODE'
                    });
                    // 3. Uint8Array に変換（BOMは絶対に入れない！）
                    const uint8Array = new Uint8Array(sjisArray);
                    // 4. Blobを作成し、charsetをShift_JISに指定
                    const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
                    const link = document.createElement("a");
                    link.setAttribute("href", URL.createObjectURL(blob));
                    link.setAttribute("download", "SHFD0006.CSV"); // 🌟ガチ仕様ファイル名
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    alert(`✅ ${finalSanteiBatchList.length}件の算定基礎届(e-Gov仕様)を Shift-JIS で出力しました！`);
                }
                catch (error) {
                    console.error("CSV出力エラー:", error);
                    alert("CSVの生成中にエラーが発生しました。");
                }
            });
            // 🌟🌟🌟 ② 【B】虫眼鏡の魔法はココ（catchの直前）に入れる！ 🌟🌟🌟
            document.getElementById('search-santei-emp')?.dispatchEvent(new Event('input'));
        }
        catch (error) {
            console.error("算定基礎エラー:", error);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">実績データの取得に失敗しました。</td></tr>`;
        }
    }; // 🌟🌟🌟 ③ ここで箱（loadSanteiData）を閉じる！ 🌟🌟🌟
    // 🌟🌟🌟 ④ 画面を開いた時に1回だけ箱を開ける（実行する） 🌟🌟🌟
    loadSanteiData();
    // 【A】算定タブのフィルター起動！
    initSalaryFilterUI('btn-santei-active', 'btn-santei-retired', 'santei-emp-filter', 'santei', loadSanteiData);
}
// 📄 給与明細のロジック（マスタ連動＆プレビュー表示）
async function initSalarySlipUI() {
    const selectEmp = document.getElementById('slip-emp-select');
    if (!selectEmp)
        return;
    try {
        // 1️⃣ Firebaseから従業員マスタを全取得
        const usersSnap = await getDocs(collection(db, 'users'));
        let activeUsers = [];
        // プルダウンを初期化
        selectEmp.innerHTML = '<option value="">▼ 従業員マスタから選択してください</option>';
        // 2️⃣ 現役社員（active）だけをプルダウンに追加！
        usersSnap.forEach((doc) => {
            const emp = doc.data();
            if (emp.employeeStatus === 'active') {
                activeUsers.push({ id: doc.id, ...emp }); // データを配列に保存しておく
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = `${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''}`;
                selectEmp.appendChild(option);
            }
        });
        // 3️⃣ プルダウンで社員が「選択」された瞬間の処理
        selectEmp.addEventListener('change', (e) => {
            const targetId = e.target.value;
            const selectedEmp = activeUsers.find(u => u.id === targetId);
            if (!selectedEmp) {
                // 未選択に戻した場合はゼロにリセット
                document.getElementById('slip-emp-name').innerText = '未選択';
                document.getElementById('slip-base').innerText = '¥0';
                document.getElementById('slip-role').innerText = '¥0';
                document.getElementById('slip-housing').innerText = '¥0';
                return;
            }
            // 💡 画面（明細書）にデータを流し込む！！
            document.getElementById('slip-emp-name').innerText = `${selectedEmp.lastNameKanji || ''} ${selectedEmp.firstNameKanji || ''}`;
            const base = Number(selectedEmp.baseHealth) || 0;
            const role = Number(selectedEmp.allowances?.role) || 0;
            const housing = Number(selectedEmp.allowances?.housing) || 0;
            document.getElementById('slip-base').innerText = `¥${base.toLocaleString()}`;
            document.getElementById('slip-role').innerText = `¥${role.toLocaleString()}`;
            document.getElementById('slip-housing').innerText = `¥${housing.toLocaleString()}`;
            // ※社会保険料や税金の計算は次のフェーズで作るので、今は¥0のままでOK！
        });
        // 📤 従業員ダッシュボードへの公開（送信）ボタンの処理
        const publishBtn = document.getElementById('btn-publish-slip');
        publishBtn?.addEventListener('click', async () => {
            const targetUserId = selectEmp.value;
            const currentName = document.getElementById('slip-emp-name')?.innerText;
            if (!targetUserId || currentName === '未選択') {
                alert('公開する従業員を選択してください。');
                return;
            }
            if (!confirm(`📤 ${currentName}さんの給与明細を従業員ダッシュボードに公開しますか？\n（本人のスマホやPCから閲覧可能になります）`))
                return;
            // 💡 画面に表示されている金額テキスト（例: "¥4,444,444"）から、数値だけを抽出する便利関数
            const parseCurrency = (id) => {
                const text = document.getElementById(id)?.innerText || '0';
                return Number(text.replace(/[^0-9]/g, '')); // ¥やカンマを消して純粋な数字にする
            };
            // 💡 ターゲット月（一旦「2026年5月」で固定。後でドロップダウンで選べるように拡張可能です）
            const targetMonth = '2026-05';
            // Firebaseに送信する給与明細データのパッケージを作成
            const slipData = {
                userId: targetUserId,
                userName: currentName,
                targetMonth: targetMonth,
                baseAmount: parseCurrency('slip-base'),
                roleAllowance: parseCurrency('slip-role'),
                housingAllowance: parseCurrency('slip-housing'),
                healthInsurance: parseCurrency('slip-health'),
                pensionInsurance: parseCurrency('slip-pension'),
                incomeTax: parseCurrency('slip-tax'),
                publishedAt: new Date(),
                status: 'published' // 従業員側で「公開済み」か判定するためのフラグ
            };
            try {
                publishBtn.innerText = '⏳ ダッシュボードへ送信中...';
                publishBtn.disabled = true;
                // 💡 新しい引き出し「payslips（給与明細）」コレクションに保存！
                // ドキュメントIDを「ユーザーID_年月」にすることで、二重送信を防ぎ上書き更新にできる設計です
                const docId = `${targetUserId}_${targetMonth}`;
                await setDoc(doc(db, 'payslips', docId), slipData);
                alert(`✨ 送信完了！\n${currentName}さんのダッシュボードに ${targetMonth} の給与明細が届きました！`);
            }
            catch (error) {
                console.error("明細公開エラー:", error);
                alert("送信に失敗しました。");
            }
            finally {
                publishBtn.innerText = '📤 明細を従業員ダッシュボードへ公開する';
                publishBtn.disabled = false;
            }
        });
        // 🚀 全従業員への「一括公開」ボタンの処理
        const publishAllBtn = document.getElementById('btn-publish-all-slips');
        publishAllBtn?.addEventListener('click', async () => {
            if (activeUsers.length === 0) {
                alert('公開対象の現役従業員がマスタに登録されていません。');
                return;
            }
            if (!confirm(`⚠️ 🚀 本当に実行しますか？\n\n現在マスタにいる現役従業員【 ${activeUsers.length} 名 】全員の給与明細を一括でダッシュボードに公開します。`))
                return;
            const targetMonth = '2026-05'; // 対象月
            try {
                publishAllBtn.innerText = '⏳ 全員分を一括送信中...';
                publishAllBtn.disabled = true;
                // 🔥 ループ処理発動！現役社員の配列を一人ずつ処理していく
                for (const emp of activeUsers) {
                    const fullName = `${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''}`;
                    // 💡 画面ではなく、配列内の各データの値を直接計算する！
                    const base = Number(emp.baseHealth) || 0;
                    const role = Number(emp.allowances?.role) || 0;
                    const housing = Number(emp.allowances?.housing) || 0;
                    const slipData = {
                        userId: emp.id,
                        userName: fullName,
                        targetMonth: targetMonth,
                        baseAmount: base,
                        roleAllowance: role,
                        housingAllowance: housing,
                        healthInsurance: 0, // 次フェーズで計算
                        pensionInsurance: 0, // 次フェーズで計算
                        incomeTax: 0, // 次フェーズで計算
                        publishedAt: new Date(),
                        status: 'published'
                    };
                    // 一人ひとりのドキュメントIDを作ってFirebaseに書き込み（setDoc）
                    const docId = `${emp.id}_${targetMonth}`;
                    await setDoc(doc(db, 'payslips', docId), slipData);
                }
                alert(`🏆 処理が完了しました！\n現役従業員 ${activeUsers.length} 名全員のダッシュボードへ給与明細を一括公開しました！`);
            }
            catch (error) {
                console.error("一括公開エラー:", error);
                alert("一括送信の途中でエラーが発生しました。");
            }
            finally {
                publishAllBtn.innerText = '🚀 全従業員へ一括公開する';
                publishAllBtn.disabled = false;
            }
        });
    }
    catch (error) {
        console.error('給与明細UIの初期化エラー:', error);
    }
}
// ==========================================
// ✅ タスク管理タブがクリックされた時の処理
// ==========================================
const taskTabBtn = document.querySelector('[data-tab="tab-task"]');
if (taskTabBtn) {
    taskTabBtn.addEventListener('click', () => {
        const container = document.getElementById('tab-task');
        if (container) {
            // 💡 tab-task.html を遅延読み込みする！
            fetch('/src/tab-task.html')
                .then(response => response.text())
                .then(htmlText => {
                container.innerHTML = htmlText;
                if (typeof initTaskUI === 'function')
                    initTaskUI();
            })
                .catch(err => console.error('タスク画面の読込エラー:', err));
        }
    });
}
// ==========================================
// 🔄 リロード対策：最後に開いていたタブを記憶して自動復元
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    // ① 画面上のすべてのタブボタンを取得
    const allTabBtns = document.querySelectorAll('[data-tab]');
    // ② タブがクリックされるたびに、そのタブの名前を「メモ（localStorage）」に残す
    allTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetTab = e.currentTarget.getAttribute('data-tab');
            if (targetTab) {
                localStorage.setItem('lastActiveTab', targetTab);
            }
        });
    });
    // ③ ページをリロード（再読み込み）した時の処理
    setTimeout(() => {
        // メモ帳から最後に開いていたタブの名前を取り出す（初回は従業員一覧をデフォルトにする）
        const savedTab = localStorage.getItem('lastActiveTab') || 'tab-employee-list';
        // その名前を持つボタンを探し出し、JavaScriptの力で「自動でクリック」する！
        const tabToClick = document.querySelector(`[data-tab="${savedTab}"]`);
        if (tabToClick) {
            tabToClick.click();
        }
    }, 100); // 💡 画面の描画が少し落ち着いた0.1秒後に発動させるのが安定のコツ
});
// 🌟 カレンダーを監視し、6月になったら「算定基礎届」タスクを自動生成する関数（完全版）
async function checkAndCreateSanteiTask() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    if (currentMonth === 6) {
        // 🌟 1. 会社IDを取得して専用キーを作成！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId)
            return;
        const taskKey = `hr_tasks_${currentCompanyId}`;
        // 🌟 2. 専用キーで読み込み！
        const savedTasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
        // 🌟 重複チェック：エラーを防ぐために魔法の「?」を追加！
        const exists = savedTasks.some((t) => t.title === '【重要・全社】算定基礎届の作成および提出' &&
            t.deadline?.startsWith(`${currentYear}`));
        if (!exists) {
            console.log("📝 今年の算定タスクを作成します！");
            const newTask = {
                id: Date.now(),
                title: '【重要・全社】算定基礎届の作成および提出',
                empName: '全従業員',
                agency: '年金事務所',
                status: 'todo',
                deadline: `${currentYear}-07-10`,
                source: '自動検知(定時決定)',
                createdAt: new Date().toISOString(),
                memo: '4月〜6月の給与データを元に算定基礎届を作成し、e-Govで提出してください。'
            };
            savedTasks.push(newTask);
            localStorage.setItem(taskKey, JSON.stringify(savedTasks)); // 🌟 3. 専用キーで保存！
            console.log(`🎉 ${currentYear}年の算定基礎届タスクを自動生成しました！`);
            window.location.reload();
        }
    }
}
// 🌟🌟🌟 どこからでも呼べる！月額変更届（ガチ仕様）のCSV生成エンジン 🌟🌟🌟
// 🌟 どこからでも呼べる！月額変更届（ガチ仕様・全49項目）のCSV生成エンジン
async function downloadGeppenCSV(targetYear, targetMonth, targetEmpName) {
    try {
        // 1. Firebaseから会社情報を取得 (e-Gov連携用)
        let companyMaster = {};
        // ⭕ 書き換え後
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId)
            return;
        const docSnap = await getDoc(doc(db, 'companies', currentCompanyId)); // 自分の会社の箱
        if (docSnap.exists()) {
            companyMaster = docSnap.data();
        }
        else {
            alert("⚠️ 会社情報が設定されていません。「法定料率・マスター」タブで保存してください。");
            return;
        }
        // 2. 従業員情報と給与履歴を一括取得
        const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
        const usersSnapshot = await getDocs(usersQuery);
        const firestoreUsersMap = {};
        usersSnapshot.forEach((d) => {
            const data = d.data();
            const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
            firestoreUsersMap[fullName] = data;
            firestoreUsersMap[fullName.replace(/\s+/g, '')] = data;
        });
        const payrollQuery = query(collection(db, "monthly_payroll_records"), where("companyId", "==", currentCompanyId));
        const payrollsSnapshot = await getDocs(payrollQuery);
        const payrollRecords = [];
        payrollsSnapshot.forEach((doc) => payrollRecords.push(doc.data()));
        const localMasterDB = JSON.parse(localStorage.getItem('hr_employee_master') || '{}');
        // ==========================================
        // 🌟 1. e-Gov用メタデータと和暦エンジン
        // ==========================================
        const csvMeta = {
            mediaSeq: "001",
            creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
            repCode: "22217" // 🔥 修正：月額変更届（随時改定）のコードは「22217」です！
        };
        const getEgoveDate = (dateStr) => {
            if (!dateStr)
                return { gengo: "", date: "" };
            const d = new Date(dateStr);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            if (y >= 2019)
                return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
            if (y >= 1989)
                return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
            return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
        };
        // ==========================================
        // 🌟 2. 会社情報の最強抽出エンジン（月変にも搭載！）
        // ==========================================
        const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
        const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
        const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
        const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
        const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
        const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
        const zipSplit = rawZip.split('-');
        const zip1 = zipSplit[0] || "";
        const zip2 = zipSplit[1] || "";
        const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
        const telSplit = rawTel.split('-');
        const tel1 = telSplit[0] || "";
        const tel2 = telSplit[1] || "";
        const tel3 = telSplit[2] || "";
        const compName = companyMaster.companyName || companyMaster.name || "";
        const repName = companyMaster.employerName || companyMaster.representativeName || "";
        // ==========================================
        // 🌟 3. 管理レコード（[kanri]ブロック）生成
        // ==========================================
        let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
        csvContent += "[kanri]\n,001\n";
        csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
        csvContent += "[data]\n";
        let outputCount = 0;
        // 🌟 改定年月（新しい保険料が適用される月）の計算：対象月の「翌月」
        let applyYear = targetYear;
        let applyMonth = targetMonth + 1;
        if (applyMonth > 12) {
            applyMonth = 1;
            applyYear++;
        }
        const applyDate = new Date(`${applyYear}-${String(applyMonth).padStart(2, '0')}-01`);
        const applyEGov = getEgoveDate(applyDate.toISOString());
        // 社員ごとに処理ループ
        usersSnapshot.forEach((docSnap) => {
            const emp = docSnap.data();
            const empId = docSnap.id;
            const fullName = `${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''}`.trim();
            // 特定の社員のみ処理する場合のスキップ判定
            if (targetEmpName && fullName !== targetEmpName && fullName.replace(/\s+/g, '') !== targetEmpName)
                return;
            // 🌟 正しいID取得（employeeIdを最優先で探す！）
            const targetEmpId = String(emp.employeeId || emp.employeeNumber || empId);
            // 給与データを取得し、日付の【古い順】に並び替え（配列の処理がしやすくなります）
            const empHistory = payrollRecords
                .filter(r => String(r.employeeId) === targetEmpId)
                .sort((a, b) => {
                if (Number(a.year) !== Number(b.year))
                    return Number(a.year) - Number(b.year);
                return Number(a.month) - Number(b.month);
            });
            // 指定月以前のデータに絞り込み
            const historyFromTarget = empHistory.filter(r => Number(r.year) < targetYear || (Number(r.year) === targetYear && Number(r.month) <= targetMonth));
            // 直近3ヶ月分のデータが揃っているか確認
            if (historyFromTarget.length >= 3) {
                const last3 = historyFromTarget.slice(-3); // 古い順なので：[0]=前3ヶ月, [1]=前2ヶ月, [2]=前1ヶ月（最新）
                // 🌟 先に社保区分を読み込む！
                const socInsType = emp.socialInsuranceType || localMasterDB[fullName]?.socialInsuranceType || "regular";
                // 🌟 短時間労働者（11日基準）なら11日、通常従業員なら17日を基準にする！
                const requiredDays = socInsType === "short_time" ? 11 : 17;
                // 一律17日ではなく、それぞれの基準日数で判定する！
                const isDaysValid = last3.every(r => Number(r.days) >= requiredDays);
                if (isDaysValid) {
                    const total3Months = last3.reduce((sum, r) => sum + Number(r.totalWage || 0), 0);
                    const avgWage = Math.floor(total3Months / 3);
                    const currentBase = Number(emp.baseHealth || 0);
                    const newInsurance = calculateSocialInsurance(avgWage);
                    const diff = Math.abs(newInsurance.healthGrade - (emp.healthGrade || 1));
                    if (diff >= 2) {
                        const kana = emp.lastNameKana ? `${emp.lastNameKana} ${emp.firstNameKana}`.trim() : (localMasterDB[fullName]?.kana || "");
                        const myNumber = emp.myNumber || localMasterDB[fullName]?.myNumber || "";
                        const pensionNum = emp.basicPensionNumber || emp.pensionNumber || localMasterDB[fullName]?.pensionNumber || "";
                        const rawDob = emp.birthdate || emp.birthDate || localMasterDB[fullName]?.dob || "";
                        const birthEGov = getEgoveDate(rawDob);
                        // 昇降給区分の判定 (1:昇給, 2:降給)
                        const upDownFlag = avgWage > currentBase ? "1" : "2";
                        // 🌟 短時間労働者フラグ（項番45）のセット
                        let shortTimeFlag = "";
                        if (socInsType === "short_time") {
                            shortTimeFlag = "1";
                        }
                        // 🌟 仕様書完全準拠：【事業所番号】をあえて抜いた「全49項目」の特殊配列！
                        const row = [
                            "2221700", // 1. 様式コード
                            prefCode, // 2. 都道府県コード ✨
                            cityCode, // 3. 郡市区符号 ✨
                            officeSymbol, // 4. 事業所記号 ✨
                            targetEmpId, // 5. 整理番号 (★事業所番号はスキップ!)
                            kana, // 6. 氏名カナ
                            fullName, // 7. 氏名漢字
                            birthEGov.gengo, // 8. 生年月日_元号
                            birthEGov.date, // 9. 生年月日_年月日
                            applyEGov.gengo, // 10. 改定年月_元号
                            applyEGov.date.substring(0, 2), // 11. 改定年月_年
                            String(applyMonth).padStart(2, '0'), // 12. 改定年月_月
                            currentBase.toString(), // 13. 従前の標準報酬月額（健保）
                            currentBase.toString(), // 14. 従前の標準報酬月額（厚年）
                            "", "", "", // 15-17. 従前の改定年月
                            String(last3[0].month).padStart(2, '0'), // 18. 昇降給月 (一番古い月)
                            upDownFlag, // 19. 昇降給区分
                            "", "", // 20-21. 遡及支払
                            String(last3[0].month).padStart(2, '0'), // 22. 前三ヶ月月
                            String(last3[1].month).padStart(2, '0'), // 23. 前二ヶ月月
                            String(last3[2].month).padStart(2, '0'), // 24. 前一ヶ月月
                            last3[0].days, last3[1].days, last3[2].days, // 25-27. 基礎日数
                            last3[0].totalWage, last3[1].totalWage, last3[2].totalWage, // 28-30. 通貨による額
                            "0", "0", "0", // 31-33. 現物額
                            last3[0].totalWage, last3[1].totalWage, last3[2].totalWage, // 34-36. 合計額
                            total3Months.toString(), // 37. 総計
                            avgWage.toString(), // 38. 平均額
                            "", // 39. 修正平均額
                            myNumber, // 40. 個人番号
                            "", // 41. 課所符号
                            pensionNum, // 42. 一連番号（年金番号）
                            "", // 43. 備考欄項目1 (70歳以上被用者等)
                            "", // 44. 備考欄項目2 (二以上事業所等)
                            shortTimeFlag, // 45. 備考欄項目3 ✨ (短時間労働者フラグ: 11日基準)
                            "", // 46. 備考欄項目4 (基本給の変更等)
                            "", // 47. 備考欄項目5 (70歳到達等)
                            "", // 48. 備考欄（フリーテキスト）
                            "" // 49. 70歳以上届出
                        ];
                        csvContent += row.join(",") + "\n";
                        outputCount++;
                    }
                }
            }
        });
        if (outputCount === 0) {
            alert(`⚠️ 対象となる月額変更（随時改定）の従業員が見つかりませんでした。\n※条件: ${targetYear}年${targetMonth}月までの3ヶ月間で平均4万円以上の変動`);
            return;
        }
        // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（月変版）
        // 1. まず文字列を文字コードの配列に変換
        const unicodeArray = Encoding.stringToCode(csvContent);
        // 2. UNICODE から SJIS に変換
        const sjisArray = Encoding.convert(unicodeArray, {
            to: 'SJIS',
            from: 'UNICODE'
        });
        // 3. Uint8Array に変換（BOMは絶対に入れない！）
        const uint8Array = new Uint8Array(sjisArray);
        // 4. Blobを作成し、charsetをShift_JISに指定
        const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", "SHFD0006.CSV"); // ガチ仕様ファイル名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        alert(`✅ ${outputCount}件の月額変更届(e-Gov仕様)を Shift-JIS で出力しました！`);
    }
    catch (error) {
        console.error("CSV出力エラー:", error);
        alert("CSVの生成中にエラーが発生しました。");
    }
}
// グローバルから呼べるように窓口を開けておく
window.downloadGeppenCSV = downloadGeppenCSV;
// 🌟 どこからでも呼べる！賞与支払届（ガチ仕様）のCSV生成エンジン【Firestore完全連携版】
async function downloadShoyoCSV(targetDate) {
    try {
        alert(`⏳ ${targetDate} 支給分の賞与データを収集し、CSVを生成しています...`);
        // 1. Firebaseから会社情報を取得 (e-Gov連携用)
        // 1. Firebaseから会社情報を取得 (e-Gov連携用)
        let companyMaster = {};
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId) {
            alert("会社情報が読み込めません。再読み込みしてください。");
            return;
        }
        const docSnap = await getDoc(doc(db, 'companies', currentCompanyId));
        if (docSnap.exists()) {
            companyMaster = docSnap.data();
        }
        else {
            alert("⚠️ 会社情報が設定されていません。「法定料率・マスター」タブで保存してください。");
            return;
        }
        // 2. 従業員情報を一括取得（マイナンバーや基礎年金番号のため）
        const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
        const usersSnapshot = await getDocs(usersQuery);
        const employees = [];
        usersSnapshot.forEach((docSnap) => {
            employees.push({ id: docSnap.id, ...docSnap.data() });
        });
        // 3. 🌟 真のデータソース！Firestoreから賞与履歴をごっそり取得
        // 3. 🚨 真のデータソース！Firestoreから賞与履歴をごっそり取得
        const bonusQuery = query(collection(db, "bonus_payroll_records"), where("companyId", "==", currentCompanyId));
        const bonusSnapshot = await getDocs(bonusQuery);
        const bonusRecords = [];
        bonusSnapshot.forEach((doc) => bonusRecords.push(doc.data()));
        // 指定された「賞与支給日（targetDate）」のデータだけを抽出
        const targetBonuses = bonusRecords.filter(r => r.paymentDate === targetDate);
        if (targetBonuses.length === 0) {
            alert(`⚠️ ${targetDate} 支給の賞与データがデータベースに見つかりません。先に「保存」を行ってください。`);
            return;
        }
        // メタデータと和暦エンジン
        const csvMeta = {
            mediaSeq: "001",
            creationDate: new Date().toISOString().substring(0, 10).replace(/-/g, ''),
            repCode: "22223"
        };
        const getEgoveDate = (dateStr) => {
            if (!dateStr)
                return { gengo: "", date: "" };
            const d = new Date(dateStr);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            if (y >= 2019)
                return { gengo: "9", date: String(y - 2018).padStart(2, '0') + m + day };
            if (y >= 1989)
                return { gengo: "7", date: String(y - 1988).padStart(2, '0') + m + day };
            return { gengo: "5", date: String(y - 1925).padStart(2, '0') + m + day };
        };
        // ==========================================
        // 🌟 会社情報の最強抽出エンジン（賞与にも搭載！）
        // ==========================================
        const prefCode = companyMaster.prefCode || (companyMaster.mainBranch?.prefCode) || "";
        const cityCode = companyMaster.cityCode || (companyMaster.mainBranch?.cityCode) || "";
        const officeSymbol = companyMaster.officeSymbol || (companyMaster.mainBranch?.officeSymbol) || "";
        const officeNumber = companyMaster.officeNumber || (companyMaster.mainBranch?.officeNumber) || "";
        const address = companyMaster.address || (companyMaster.mainBranch?.address) || "";
        const rawZip = companyMaster.zipCode || (companyMaster.mainBranch?.zipCode) || "";
        const zipSplit = rawZip.split('-');
        const zip1 = zipSplit[0] || "";
        const zip2 = zipSplit[1] || "";
        const rawTel = companyMaster.tel || companyMaster.phone || (companyMaster.mainBranch?.tel) || "";
        const telSplit = rawTel.split('-');
        const tel1 = telSplit[0] || "";
        const tel2 = telSplit[1] || "";
        const tel3 = telSplit[2] || "";
        const compName = companyMaster.companyName || companyMaster.name || "";
        const repName = companyMaster.employerName || companyMaster.representativeName || "";
        // ==========================================
        // 🌟 管理レコード([kanri]ブロック)生成
        // ==========================================
        let csvContent = `${prefCode},${cityCode},${officeSymbol},${csvMeta.mediaSeq},${csvMeta.creationDate},${csvMeta.repCode}\n`;
        csvContent += "[kanri]\n,001\n";
        csvContent += `${prefCode},${cityCode},${officeSymbol},${officeNumber},${zip1},${zip2},${address},${compName},${repName},${tel1},${tel2},${tel3}\n`;
        csvContent += "[data]\n";
        let outputCount = 0;
        const bonusDateEGov = getEgoveDate(targetDate); // 支給日は引数から生成
        // 🌟 データレコード作成（従業員リストをベースに回す）
        employees.forEach((emp) => {
            // その従業員の今回の賞与データがFirestoreにあるか探す
            const targetEmpId = String(emp.employeeId || emp.employeeNumber || emp.id);
            const record = targetBonuses.find(r => String(r.employeeId) === targetEmpId);
            if (record) {
                const fullName = (emp.lastNameKanji || emp.firstNameKanji) ? `${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''}`.trim() : "名称未設定";
                const kana = emp.lastNameKana ? `${emp.lastNameKana} ${emp.firstNameKana}`.trim() : "";
                const myNumber = emp.myNumber || "";
                const pensionNum = emp.basicPensionNumber || emp.pensionNumber || "";
                // 🔥 生年月日の大文字・小文字ブレ対策（最強の安全網）
                const rawDob = emp.birthdate || emp.birthDate || "";
                const birthEGov = getEgoveDate(rawDob);
                // Firestoreのフィールド（bonusWage）から賞与額を取得
                const exactBonus = Number(record.bonusWage || 0);
                const cashBonus = exactBonus; // 12番: 1円単位までそのまま
                const materialBonus = 0; // 13番: 現物は0固定
                const totalBonus = Math.floor(exactBonus / 1000) * 1000; // 🌟 14番: 1000円未満を切り捨て！
                // 🌟 仕様書完全準拠：抽出したキレイな変数を使う！
                const row = [
                    "2231700", // 1. 様式コード（賞与支払届）
                    prefCode, // 2. 都道府県コード ✨
                    cityCode, // 3. 郡市区符号 ✨
                    officeSymbol, // 4. 事業所記号 ✨
                    targetEmpId, // 5. 整理番号
                    kana, // 6. 氏名カナ
                    fullName, // 7. 氏名漢字
                    birthEGov.gengo, // 8. 生年月日_元号
                    birthEGov.date, // 9. 生年月日_年月日
                    bonusDateEGov.gengo, // 10. 賞与支払年月日_元号
                    bonusDateEGov.date, // 11. 賞与支払年月日_年月日
                    cashBonus.toString(), // 12. 通貨によるものの額
                    materialBonus.toString(), // 13. 現物によるものの額
                    totalBonus.toString(), // 14. 合計（賞与額 千円未満切り捨て）
                    myNumber, // 15. 個人番号
                    "", // 16. 課所符号
                    pensionNum, // 17. 一連番号（基礎年金番号）
                    "", "", "", // 18-20. 備考欄項目1〜3
                    "" // 21. 70歳以上被用者届のみ提出
                ];
                csvContent += row.join(",") + "\n";
                outputCount++;
            }
        });
        if (outputCount === 0) {
            alert(`⚠️ 賞与データと一致する従業員が見つかりませんでした。`);
            return;
        }
        // 🌟 【e-Gov完全仕様】文字列をShift-JISに変換する魔法！（月変版）
        // 1. まず文字列を文字コードの配列に変換
        const unicodeArray = Encoding.stringToCode(csvContent);
        // 2. UNICODE から SJIS に変換
        const sjisArray = Encoding.convert(unicodeArray, {
            to: 'SJIS',
            from: 'UNICODE'
        });
        // 3. Uint8Array に変換（BOMは絶対に入れない！）
        const uint8Array = new Uint8Array(sjisArray);
        // 4. Blobを作成し、charsetをShift_JISに指定
        const blob = new Blob([uint8Array], { type: 'text/csv;charset=Shift_JIS;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", "SHFD0006.CSV"); // ガチ仕様ファイル名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        alert(`✅ ${outputCount}件の賞与届(e-Gov仕様)を Shift-JIS で出力しました！`);
    }
    catch (error) {
        console.error("賞与CSV出力エラー:", error);
        alert("CSVの生成中にエラーが発生しました。");
    }
}
// グローバル窓口を開ける
window.downloadShoyoCSV = downloadShoyoCSV;
// 🌟🌟🌟 従業員からの申請を検知してカンバンにタスク化する最強エンジン 🌟🌟🌟
async function fetchEmployeeRequestsAndCreateTasks() {
    try {
        // 🌟 1. 会社IDを取得して専用キーを作成！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId)
            return;
        const taskKey = `hr_tasks_${currentCompanyId}`;
        // 🌟 2. 【超重要】Firestoreの読み込みにも「自分の会社」のフィルターを追加！！！
        const q = query(collection(db, "changeRequests"), where("companyId", "==", currentCompanyId), // 👈 これがないと他社の申請が丸見えになります！
        where("status", "==", "pending"));
        const querySnapshot = await getDocs(q);
        // カンバンの現在のタスク一覧を読み込む（🌟 専用キーで！）
        const savedTasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
        let isNewTaskAdded = false;
        for (const docSnap of querySnapshot.docs) { // for...of に変えると非同期処理が安定します
            const reqData = docSnap.data();
            const reqId = docSnap.id;
            // 2. すでにこの申請のタスクが作られていないかチェック（二重生成の防止）
            const exists = savedTasks.some((t) => t.sourceId === reqId);
            if (!exists) {
                // 3. カンバン用のタスクカードを生成！
                const newTask = {
                    id: Date.now() + Math.floor(Math.random() * 1000), // ユニークなID
                    title: `【確認】${reqData.type} の処理`,
                    empName: `対象者ID: ${reqData.employeeId}`, // ※将来的にマスタと繋げて名前に変換可能
                    agency: '社内処理', // まずは社内マスタの更新から！
                    status: 'todo', // 未着手レーンへ
                    deadline: new Date(new Date().getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 期限は3日後
                    source: '従業員申請',
                    sourceId: reqId, // ★超重要：この申請から生まれたタスクであるという証拠
                    createdAt: new Date().toISOString(),
                    memo: `【変更日】${reqData.changeDate}\n【新氏名】${reqData.newLastName || '変更なし'} ${reqData.newFirstName || ''}\n【新住所】${reqData.newAddress || '変更なし'}\n\n内容を確認し、社員マスタを更新してください。`
                };
                savedTasks.push(newTask);
                isNewTaskAdded = true;
                // 🌟 自動承認済みとしてマーク（重複防止のため、ここでステータスを更新！）
                await updateDoc(doc(db, "changeRequests", reqId), { status: "in_progress" });
            }
        } // ※不要なセミコロンを除去しました
        // 4. 新しいタスクがあれば保存して画面を更新！
        if (isNewTaskAdded) {
            localStorage.setItem(taskKey, JSON.stringify(savedTasks)); // 🌟 3. 専用キーで保存！
            // 新しいタスクを追加したら、画面をリロードして最新状態をカンバンに表示する！
            location.reload();
        }
    }
    catch (error) {
        console.error("申請データの取得エラー:", error);
    }
}
// // 画面が開かれたときにこのエンジンを自動で動かす！
// document.addEventListener('DOMContentLoaded', () => {
//   // 画面ロードから少しだけ遅らせて実行（他のデータベース読み込みとぶつからないための安全策）
//   setTimeout(fetchEmployeeRequestsAndCreateTasks, 1500); 
// });
// 🌟🌟🌟 ライフイベントタブに「従業員からの申請」を描画する機能（超絶デバッグ版） 🌟🌟🌟
async function renderLifeEventRequests() {
    const listContainer = document.getElementById('employee-request-container');
    const badgeCount = document.getElementById('request-badge');
    if (!listContainer)
        return;
    try {
        const currentCompanyId = localStorage.getItem('current_company_id');
        console.log("🕵️‍♂️ [受信アンテナ起動] 現在の会社ID:", currentCompanyId);
        if (!currentCompanyId) {
            if (listContainer)
                listContainer.innerHTML = '<div style="color:red; padding:10px;">会社情報が読み込めません。</div>';
            return;
        }
        const q = query(collection(db, "changeRequests"), where("companyId", "==", currentCompanyId), where("status", "==", "pending"));
        // 🌟 監視スタート！
        onSnapshot(q, (querySnapshot) => {
            console.log(`📡 [Firestore着信] 条件に合う未承認データが ${querySnapshot.size} 件見つかりました！`);
            if (querySnapshot.empty) {
                listContainer.innerHTML = `<div style="text-align:center; padding: 30px; color:#888;"><p>現在、従業員からの新たな申請はありません。</p></div>`;
                if (badgeCount)
                    badgeCount.innerText = "未承認: 0件";
                return;
            }
            let html = '';
            let count = 0;
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                count++;
                // 🔥 ここでデータを丸裸にしてコンソールに表示！
                console.log(`📦 [データ${count}件目] ID: ${docSnap.id}`);
                console.log(`┣ 種類: ${data.type}`);
                console.log(`┣ 氏名: ${data.empName}`);
                console.log(`┗ 中身:`, data);
                let detailHtml = '';
                if (data.type === "住所・氏名変更") {
                    detailHtml = `
                ${data.newLastName || data.newFirstName ? `✏️ <b>新氏名:</b> ${data.newLastName || ''} ${data.newFirstName || ''}<br>` : ''}
                ${data.newAddress ? `🏠 <b>新住所:</b> 〒${data.newZip || '---'} ${data.newAddress}<br>` : ''}
                ${data.newPass || data.newRoute ? `🚃 <b>通勤経路:</b> ${data.newRoute || '未入力'} <br>
                💰 <b>新・定期代:</b> ${data.newPass ? data.newPass.toLocaleString() : '0'} 円<br>` : ''}
             `;
                }
                else if (data.type === "ライフイベント") {
                    detailHtml = `
                📌 <b>イベント:</b> ${data.eventTitle || data.eventType}<br>
                📅 <b>発生日:</b> ${data.eventDate || data.changeDate || '不明'}<br>
             `;
                    if (data.dependent?.lastNameKanji) {
                        detailHtml += `👪 <b>対象家族:</b> ${data.dependent.lastNameKanji} ${data.dependent.firstNameKanji} (${data.dependent.relation || '続柄不明'})<br>`;
                    }
                    if (data.eventType === 'remove_family') {
                        detailHtml += `👋 <b>喪失対象:</b> ${data.targetFamilyName} <br>
                                📄 <b>理由:</b> ${data.removeReason} <br>
                                💳 <b>保険証回収:</b> ${data.cardReturnStatus || '不明'}<br>`;
                    }
                    if (data.attachedFiles && data.attachedFiles.length > 0) {
                        detailHtml += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ccc;">📎 <b>添付書類:</b><br>`;
                        data.attachedFiles.forEach((file) => {
                            detailHtml += `<a href="${file.fileUrl}" target="_blank" style="color: #0056b3; font-size: 12px; text-decoration: underline; margin-right: 10px;">📄 ${file.docName}</a>`;
                        });
                        detailHtml += `</div>`;
                    }
                }
                else if (data.type === "保険証再発行") {
                    detailHtml = `
                💳 <b>理由:</b> ${data.dependent?.reason || '不明'}<br>
                📅 <b>発生日:</b> ${data.eventDate || '不明'}<br>
                🚨 <b>警察届出:</b> ${data.dependent?.policeReport || '不要'}<br>
                📝 <b>メモ:</b> ${data.dependent?.memo || 'なし'}<br>
             `;
                }
                else if (data.type === "退職") {
                    detailHtml = `
                🚪 <b>退職日:</b> ${data.eventDate || '不明'}<br>
                💳 <b>保険証返却:</b> ${data.dependent?.insuranceReturn || '不明'}<br>
                📄 <b>離職票:</b> ${data.dependent?.unemploymentSlip || '未選択'}<br>
             `;
                }
                html += `
            <div class="request-card" style="border: 1px solid #d1d5db; padding: 15px; margin-bottom: 15px; border-radius: 8px; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px; margin-bottom: 8px;">
                <strong style="color: #0056b3; font-size: 15px;">【${data.type || data.eventTitle || '申請'}】</strong>
                <span style="font-size: 12px; color: #6b7280;">申請日: ${data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : '最近'}</span>
              </div>
              <div style="font-size: 14px; color: #374151; line-height: 1.6;">
                👤 <b>対象者:</b> ${data.empName || '氏名不明'} (ID: ${data.employeeId}) <br>
                <div style="margin-top: 8px; background: #f8f9fa; padding: 10px; border-radius: 4px; border-left: 3px solid #ffc107;">
                    ${detailHtml}
                </div>
              </div>
              <div style="margin-top: 15px; text-align: right;">
                <button onclick="approveRequest('${docSnap.id}')" class="btn-approve-request" style="background: #28a745; color: white; border: none; padding: 6px 15px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: 0.2s;">内容を確認して承認</button>          
              </div>
            </div>
         `;
            });
            listContainer.innerHTML = html;
            if (badgeCount)
                badgeCount.innerText = `未承認: ${count}件`;
        }, (error) => {
            console.error("🚨 [Firestoreエラー] onSnapshotでエラー発生！", error);
        });
    }
    catch (error) {
        console.error("申請データの描画エラー:", error);
    }
}
// 🌟🌟🌟 ワンクリック承認エンジン（マスタ自動更新＆タスク生成） 🌟🌟🌟
// Firestore関連の関数（getDoc, doc, updateDoc など）が一番上でimportされているか確認してください！
window.approveRequest = async (requestId) => {
    try {
        // 🌟 1. 会社IDを取得して専用キーを作成！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId) {
            alert("会社情報が読み込めません。");
            return;
        }
        const taskKey = `hr_tasks_${currentCompanyId}`;
        // 🌟 復元：消し飛んでいた「申請データの取得」処理！！！
        const requestRef = doc(db, "changeRequests", requestId);
        const requestSnap = await getDoc(requestRef);
        if (!requestSnap.exists()) {
            alert("申請データが見つかりません。");
            return;
        }
        const reqData = requestSnap.data();
        const empId = reqData.employeeId;
        // 🌟 2. 従業員を検索する時も「自分の会社」のフィルターを追加
        const q = query(collection(db, "users"), where("companyId", "==", currentCompanyId), where("employeeId", "==", empId));
        const empSnapshot = await getDocs(q);
        if (!empSnapshot.empty) {
            const empDoc = empSnapshot.docs[0];
            const updateData = {};
            if (reqData.newZip)
                updateData.zipCode = reqData.newZip;
            if (reqData.newAddress)
                updateData.currentAddress = reqData.newAddress;
            if (reqData.newPass)
                updateData['allowances.commute'] = reqData.newPass;
            if (reqData.newLastName)
                updateData.lastName = reqData.newLastName;
            if (reqData.newFirstName)
                updateData.firstName = reqData.newFirstName;
            await updateDoc(doc(db, "users", empDoc.id), updateData);
        }
        else {
            console.warn(`社員ID: ${empId} のマスタが見つかりませんでした。タスク生成のみ行います。`);
        }
        // 3. 申請のステータスを「承認済み(approved)」に変更して一覧から消す
        await updateDoc(requestRef, { status: "approved" });
        // 4. カンバンに「e-Gov提出用タスク」を自動生成！
        const savedTasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
        const newTaskTitle = `【重要】${reqData.newLastName || ''} ${reqData.newFirstName || ''}様（ID:${empId}）の ${reqData.type} 届作成`;
        const newTask = {
            id: Date.now(),
            title: newTaskTitle,
            empName: empId,
            agency: '年金事務所',
            status: 'todo',
            deadline: new Date(new Date().getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            source: '自動検知(承認済)',
            createdAt: new Date().toISOString(),
            memo: `【承認済】従業員からの申請に基づき、社員マスタ（住所・通勤手当等）は自動更新されました。\ne-GovからCSVを出力して提出してください。\n（※マイナンバー連携済みの場合は提出不要です。社内用として完了にしてください）`,
            targetId: requestId
        };
        savedTasks.push(newTask);
        localStorage.setItem(taskKey, JSON.stringify(savedTasks));
        alert("🌟 承認完了！\n社員マスタと通勤手当が自動更新され、カンバンにタスクが生成されました！");
        location.reload();
    }
    catch (error) {
        console.error("承認処理エラー:", error);
        alert("承認処理に失敗しました。");
    }
};
// 画面ロード時に描画エンジンを回す！
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderLifeEventRequests, 500);
});
// ==========================================
// 🛠️ CSVダウンロードを実行する共通ヘルパー関数
// ==========================================
function downloadCSV(content, fileName) {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
// ==========================================
// 🏢 会社設定（給与計算連動マスタ）の保存と読み込み
// ==========================================
// 🌟 1. 保存ボタンの処理（イベントデリゲーション方式：後からボタンが作られても絶対反応する神設定！）
// ==================================================
// 🏢 会社設定（給与計算連動マスタ）の保存と読み込み（マルチテナント完全版）
// ==================================================
// 1. 画面を開いたときに、DBから自分の会社の設定値を読み込んで表示する
setTimeout(async () => {
    try {
        const cid = localStorage.getItem('current_company_id');
        if (!cid)
            return; // 会社IDがなければ無視
        // 正しい会社のドキュメントを読みに行く
        const snap = await getDoc(doc(db, 'companies', cid));
        if (snap.exists()) {
            const data = snap.data();
            const cutoffSelect = document.getElementById('company-cutoff-day');
            const payMonthSelect = document.getElementById('company-payment-month');
            const payDaySelect = document.getElementById('company-payment-day');
            // DBにデータがあれば、プルダウンの選択肢を自動で切り替える
            if (cutoffSelect && data.cutoffDay)
                cutoffSelect.value = data.cutoffDay;
            if (payMonthSelect && data.paymentMonth)
                payMonthSelect.value = data.paymentMonth;
            if (payDaySelect && data.paymentDay)
                payDaySelect.value = data.paymentDay;
        }
    }
    catch (error) {
        console.error("設定の読み込みエラー:", error);
    }
}, 500); // 画面の描画を少し待ってから読み込む
// 2. 保存ボタンの処理
document.addEventListener('click', async (e) => {
    const target = e.target;
    // もしクリックされたのが「給与ルールを保存する」ボタンだったら
    if (target && target.id === 'btn-save-company-pay-rules') {
        const cid = localStorage.getItem('current_company_id');
        if (!cid) {
            alert("エラー：会社IDが取得できませんでした。");
            return;
        }
        const cutoffVal = document.getElementById('company-cutoff-day')?.value;
        const payMonthVal = document.getElementById('company-payment-month')?.value;
        const payDayVal = document.getElementById('company-payment-day')?.value;
        try {
            // 正しい会社（companies内のcid）に保存する！！
            await updateDoc(doc(db, 'companies', cid), {
                cutoffDay: cutoffVal,
                paymentMonth: payMonthVal,
                paymentDay: payDayVal,
                updatedAt: serverTimestamp()
            });
            alert(`✅ 給与計算ルールを保存しました！\n締め日: ${cutoffVal}\n支払月: ${payMonthVal}\n\n（給与タブの労働期間表示にも反映されます）`);
        }
        catch (error) {
            console.error("会社設定の保存に失敗:", error);
            alert("保存エラーが発生しました。");
        }
    }
});
// 🌟 2. 画面を開いたときに設定値を表示する処理
// （HTMLが後から読み込まれる時間差を考慮して、1.5秒待ってから探すように設定）
setTimeout(async () => {
    try {
        const snap = await getDoc(doc(db, 'settings', 'company'));
        if (snap.exists()) {
            const data = snap.data();
            const cutoffSelect = document.getElementById('company-cutoff-day');
            const payMonthSelect = document.getElementById('company-payment-month');
            const payDaySelect = document.getElementById('company-payment-day');
            if (cutoffSelect && data.cutoffDay)
                cutoffSelect.value = data.cutoffDay;
            if (payMonthSelect && data.paymentMonth)
                payMonthSelect.value = data.paymentMonth;
            if (payDaySelect && data.paymentDay)
                payDaySelect.value = data.paymentDay;
            console.log("🏢 給与計算マスタの読み込み完了！");
        }
    }
    catch (error) {
        console.error("会社設定の読み込みエラー:", error);
    }
}, 1500);
// 🌟 manager.ts の一番下（他の処理の邪魔にならない場所）に追加！
function getLaborPeriodText(payYear, payMonth, cutoffDay, payTiming) {
    let laborYear = payYear;
    let laborMonth = payMonth;
    if (payTiming === "next") {
        laborMonth -= 1;
        if (laborMonth === 0) {
            laborMonth = 12;
            laborYear -= 1;
        }
    }
    if (cutoffDay === "末" || cutoffDay === "末日" || cutoffDay === "31") {
        const lastDay = new Date(laborYear, laborMonth, 0).getDate();
        return `（※ ${laborMonth}/1 〜 ${laborMonth}/${lastDay} 労働分）`;
    }
    else {
        const cutoffNum = parseInt(cutoffDay, 10);
        const startDay = cutoffNum + 1;
        let startMonth = laborMonth - 1;
        let startYear = laborYear;
        if (startMonth === 0) {
            startMonth = 12;
            startYear -= 1;
        }
        return `（※ ${startMonth}/${startDay} 〜 ${laborMonth}/${cutoffNum} 労働分）`;
    }
}
// ==========================================
// 🌟 法定料率・会社設定の「サブタブ」を切り替える関数
// ==========================================
window.switchSettingsTab = (targetId, clickedBtn) => {
    // 1. すべてのタブコンテンツを非表示にする
    const contents = document.querySelectorAll('.settings-tab-content');
    contents.forEach(content => {
        content.style.display = 'none';
    });
    // 2. すべてのタブボタンのスタイル（青線）をリセットする
    const buttons = document.querySelectorAll('.settings-sub-tab');
    buttons.forEach(btn => {
        btn.style.borderBottom = 'none';
        btn.style.color = '#64748b';
    });
    // 3. クリックされたタブのコンテンツを表示する
    const targetContent = document.getElementById(targetId);
    if (targetContent) {
        targetContent.style.display = 'block';
    }
    // 4. クリックされたボタンに青線をつける
    if (clickedBtn) {
        clickedBtn.style.borderBottom = '3px solid #0056b3';
        clickedBtn.style.color = '#0056b3';
    }
};
// ==========================================
// 🔄 随時改定タブのUI描画（共通関数を利用！）
// ==========================================
async function initZuijiUI() {
    // 🌟 NEW: まずプルダウンが存在するか＆空っぽかチェックして、自動生成！
    const targetSelect = document.getElementById('zuiji-target-month');
    if (targetSelect && targetSelect.options.length === 0) {
        const now = new Date();
        const currentY = now.getFullYear();
        const currentM = now.getMonth() + 1;
        for (let i = -1; i <= 5; i++) {
            let y = currentY;
            let m = currentM + i;
            if (m > 12) {
                m -= 12;
                y += 1;
            }
            if (m <= 0) {
                m += 12;
                y -= 1;
            }
            const option = document.createElement('option');
            option.value = String(m);
            option.text = `${y}年 ${m}月 改定予定`;
            if (i === 1)
                option.selected = true; // 翌月をデフォルトに
            targetSelect.appendChild(option);
        }
        // 👇＝＝＝＝＝＝ ここから追加！ ＝＝＝＝＝＝👇
        // プルダウンが変更された瞬間に、自分自身（initZuijiUI）をもう一度呼び出して再計算する！
        targetSelect.addEventListener('change', () => {
            initZuijiUI();
        });
        // ☝＝＝＝＝＝＝ ここまで追加！ ＝＝＝＝＝＝☝
    }
    const listBody = document.getElementById('zuiji-list-body');
    if (!listBody)
        return;
    listBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px;">⏳ データを分析中...</td></tr>`;
    try {
        const targetSelect = document.getElementById('zuiji-target-month');
        const revisionMonth = Number(targetSelect?.value || 7);
        const optionText = targetSelect.options[targetSelect.selectedIndex]?.text || "";
        const revisionYear = parseInt(optionText.match(/\d{4}/)?.[0] || String(new Date().getFullYear()));
        // 🌟 会社IDを取得してフィルターをかける
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId)
            return;
        const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
        const usersSnapshot = await getDocs(usersQuery);
        const employees = [];
        usersSnapshot.forEach((doc) => employees.push({ id: doc.id, ...doc.data() }));
        const payrollQuery = query(collection(db, "monthly_payroll_records"), where("companyId", "==", currentCompanyId));
        const payrollSnapshot = await getDocs(payrollQuery);
        const payrollRecords = [];
        payrollSnapshot.forEach((doc) => payrollRecords.push(doc.data()));
        // 🔥 ここで共通関数を呼び出すだけ！
        const targets = getZuijiTargets(revisionYear, revisionMonth, employees, payrollRecords);
        if (targets.length > 0) {
            let tableHTML = '';
            targets.forEach(t => {
                const gradeColor = t.newGrade > t.currentGrade ? "#d32f2f" : "#0056b3";
                const arrow = t.newGrade > t.currentGrade ? "↗" : "↘";
                tableHTML += `
              <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 12px; vertical-align: top;">
                      <strong>${t.name}</strong><br><span style="font-size: 11px; color: #666;">ID: ${t.id}</span>
                  </td>
                  <td style="padding: 12px; vertical-align: top; color: #d32f2f; font-weight: bold; font-size: 12px;">
                      ${t.m1.year}年${t.m1.month}月に<br>${t.triggerText}あり
                  </td>
                  <td style="padding: 12px; vertical-align: top;">
                      <span style="color: #0056b3; font-weight: bold;">${t.avgWage.toLocaleString()} 円</span><br>
                      <span style="font-size: 10px; color: #666;">(${t.m1.month}月〜${t.m3.month}月の実績)</span>
                  </td>
                  <td style="padding: 12px; vertical-align: top; background: #fff3cd;">
                      <span style="font-size: 11px; color: #666;">現: ${t.currentGrade}等級</span><br>
                      <strong style="color: ${gradeColor}; font-size: 14px;">新: ${t.newGrade}等級 ${arrow}</strong><br>
                      <span style="font-size: 10px; color: #888;">(差: ${t.gradeDiff}等級)</span>
                  </td>
                  <td style="padding: 12px; text-align: center; vertical-align: middle;">
                      <span style="padding: 4px 8px; background: #dc3545; color: white; border-radius: 4px; font-size: 11px; font-weight: bold;">月変対象</span>
                  </td>
              </tr>`;
            });
            listBody.innerHTML = tableHTML;
        }
        else {
            listBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: #666;">
              <strong>${revisionYear}年${revisionMonth}月改定予定</strong>の対象者は見つかりませんでした。<br>
              <span style="font-size:12px; color: #999;">※判定には対象となる3ヶ月分の給与実績が保存されている必要があります。</span>
          </td></tr>`;
        }
    }
    catch (e) {
        console.error("随時改定UIエラー:", e);
        listBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: red;">データの取得に失敗しました。</td></tr>`;
    }
}
// プルダウンを切り替えたら即座に再計算するイベント
document.getElementById('zuiji-target-month')?.addEventListener('change', () => {
    initZuijiUI();
});
loadEmployeeList();
//# sourceMappingURL=manager.js.map