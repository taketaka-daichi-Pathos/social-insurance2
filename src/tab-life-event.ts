import { collection, getDocs, doc, updateDoc, query, where, getDoc, arrayUnion, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './config/firebase.js'; // ※ご自身の環境に合わせてください

export async function initLifeEventUI() {

setupManualEventPanel();
// 🌟🌟🌟 🌟🌟🌟 🌟🌟🌟


  console.log("🎉 ライフイベント画面（一括処理＆タスク自動生成版）が正常に読み込まれました！");


　// ==========================================
  // 【パート1】従業員からの申請（統合版：名前変換・アコーディオン・一括承認）
  // ==========================================
await loadUnifiedRequests(); // 画面を開いた時にデータを読み込む！

async function loadUnifiedRequests() {
  const container = document.getElementById('unified-request-container');
  const badge = document.getElementById('request-badge');
  
  if (!container) {
    console.error("エラー: unified-request-container がHTMLに見つかりません");
    return;
  }

  try {
    const currentCompanyId = localStorage.getItem('current_company_id');
    if (!currentCompanyId) {
        container.innerHTML = '<div style="color:red; padding:30px; text-align:center;">⚠️ 会社情報が読み込めません。</div>';
        return;
    }

    // 🌟 1. 【防壁①】「自社」のユーザーだけで安全な辞書を作成（社員番号 ➔ 氏名 の保険用）
    const usersQuery = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
    const usersSnap = await getDocs(usersQuery);
    const userDict: any = {};
    usersSnap.forEach(u => {
      const data = u.data();
      const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
      if (data.email) userDict[data.email] = fullName;
      if (data.employeeId) userDict[data.employeeId] = fullName;
    });

    // 🌟 2. 【防壁②】自社の未承認申請（pending）を『すべて』取得！
    // （※従業員側は changeRequests に一本化しました！）
    const qChange = query(
        collection(db, 'changeRequests'), 
        where("companyId", "==", currentCompanyId), 
        where('status', '==', 'pending')
    );
    
    const snapChange = await getDocs(qChange);
    let allRequests: any[] = [];

    snapChange.forEach(d => {
      const data = d.data();
      const isLifeEvent = data.type === "ライフイベント" || data.type === "保険証再発行" || data.type === "退職";
      
      allRequests.push({
        id: d.id,
        dbType: 'changeRequests', // 🌟 すべてここに統一
        category: isLifeEvent ? 'life_event' : 'profile',
        title: data.eventTitle || data.type || '申請',
        email: data.userEmail || '', 
        empId: data.employeeId || '未設定',
        name: data.empName || userDict[data.employeeId] || '名称未設定', // 送信された名前を優先
        date: data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString('ja-JP') : '今日',
        rawDate: data.createdAt ? data.createdAt.seconds * 1000 : Date.now(),
        options: data.supportOptions || [],
        eventDate: data.eventDate || data.changeDate || '',
        originalData: data
      });
    });

    // 日付が新しい順に並び替え
    allRequests.sort((a, b) => b.rawDate - a.rawDate);

    if (badge) badge.innerText = `未承認: ${allRequests.length}件`;

    if (allRequests.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: #888;">📝 現在、未承認の申請はありません。</div>`;
      return;
    }

    // 🌟 3. データの描画（アコーディオン形式）
    let html = '';
    allRequests.forEach(req => {
      let detailHtml = '';
      
      // ▼① ライフイベント（結婚・出産など）の場合
      if (req.originalData.type === 'ライフイベント') {
          detailHtml = `<p style="margin:0 0 5px; font-weight:bold; color:#d84315;">📅 発生日: ${req.eventDate}</p>`;
          const evType = req.originalData.eventType;
          
          // 扶養削除
          if (evType === 'remove_family') {
              detailHtml += `<div style="margin-top: 5px; font-size: 13px; color: #333;">
                  喪失対象: <strong>${req.originalData.targetFamilyName || '不明'}</strong><br>
                  理由: ${req.originalData.removeReason || '不明'}<br>
                  <span style="color: #d32f2f; font-weight: bold;">保険証: ${req.originalData.cardReturnStatus || '未回答'}</span>
              </div>`;
          } 
          // 扶養追加
          else if (evType === 'marriage' || evType === 'other') {
              const dep = req.originalData.dependent || {};
              detailHtml += `<div style="margin-top: 5px; font-size: 13px; color: #333;">
                  追加家族: <strong>${dep.lastNameKanji || ''} ${dep.firstNameKanji || ''}</strong> (${dep.relation || '不明'})
              </div>`;
          }


// オプション（出産などの申請）
if (req.options && req.options.length > 0) {
  detailHtml += `<ul style="margin: 5px 0 0; padding-left: 20px; font-size: 13px; color: #333; font-weight: bold;">`;
  req.options.forEach((opt: string) => {
    let label = opt;
    // 🌟 英語のシステム名を、従業員画面の文章に合わせて日本語翻訳！
    if (opt === 'allowance') label = '💰 産休中のお給料の代わり（出産手当金）を申請';
    else if (opt === 'sankyu_exemption') label = '🆓 産休中の社会保険料免除の手続き';
    else if (opt === 'hellowork') label = '🏢 ハローワークからの育休手当（育児休業給付金）を申請';
    else if (opt === 'exemption') label = '🆓 育休中の社会保険料免除の手続き';
    else if (opt === 'monthly_change') label = '🛡️ 復帰後の手取りを守る特例（報酬月額変更）を申請';
    else if (opt === 'pension_special') label = '👴 将来の年金が減らないようにする特例（標準報酬特例）を申請';
    
    detailHtml += `<li style="margin-bottom: 4px;">${label}</li>`;
  });
  detailHtml += `</ul>`;
} else {
  detailHtml += `<p style="margin:0; font-size:12px; color:#666;">（必要なサポート手続きの選択はありません）</p>`;
}
      } 
      // ▼② 保険証再発行の場合
      else if (req.originalData.type === '保険証再発行') {
          const dep = req.originalData.dependent || {};
          detailHtml = `<p style="margin:0 0 5px; font-weight:bold; color:#d84315;">📅 発生日: ${req.eventDate}</p>
              <div style="font-size: 13px; color: #333;">
                  理由: <strong>${dep.reason || '不明'}</strong><br>
                  警察届出: ${dep.policeReport || '不要'}<br>
                  メモ: ${dep.memo || 'なし'}
              </div>`;
      }
      // ▼③ 退職の場合
      else if (req.originalData.type === '退職') {
          const dep = req.originalData.dependent || {};
          detailHtml = `<p style="margin:0 0 5px; font-weight:bold; color:#d84315;">🚪 退職日: ${req.eventDate}</p>
              <div style="font-size: 13px; color: #333;">
                  保険証返却: <strong>${dep.insuranceReturn || '不明'}</strong><br>
                  離職票発行: <span style="color: #d32f2f; font-weight: bold;">${dep.unemploymentSlip || '未選択'}</span>
              </div>`;
      }
      // ▼④ 住所・氏名変更の場合
      else {
          detailHtml = `<p style="margin:0 0 5px; font-weight:bold; color:#0056b3;">📅 変更発生日: ${req.eventDate}</p>
              <div style="font-size:12px; color:#555; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div><strong>新氏名:</strong> ${req.originalData.newLastName || ''} ${req.originalData.newFirstName || ''}</div>
                <div><strong>新住所:</strong> 〒${req.originalData.newZip || ''} ${req.originalData.newAddress || ''}</div>
                <div><strong>通勤経路:</strong> ${req.originalData.newRoute || '変更なし'}</div>
                <div><strong>新定期代:</strong> ${req.originalData.newPass ? req.originalData.newPass.toLocaleString() + ' 円' : '変更なし'}</div>
              </div>`;
      }

      // 🌟 📎 全共通：添付ファイルがある場合はリンクを表示
      if (req.originalData.attachedFiles && req.originalData.attachedFiles.length > 0) {
          detailHtml += `<div style="margin-top: 8px; font-size: 12px; background: #e3f2fd; padding: 6px; border-radius: 4px;">📎 添付書類: `;
          req.originalData.attachedFiles.forEach((file: any) => {
              detailHtml += `<a href="${file.fileUrl}" target="_blank" style="color: #0056b3; margin-right: 12px; text-decoration: underline; font-weight: bold;">📄 ${file.docName}</a>`;
          });
          detailHtml += `</div>`;
      }

      const badgeColor = req.category === 'life_event' ? '#fd7e14' : '#0d6efd';
      const badgeBg = req.category === 'life_event' ? '#fff3cd' : '#cfe2ff';

      // HTML枠組み
      html += `
        <div class="req-row" data-category="${req.category}" style="border-bottom: 1px solid #f3f4f6;">
          <div class="req-summary" style="display: flex; align-items: center; padding: 12px 15px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="req-checkbox" value="${req.id}" data-options='${JSON.stringify(req.options)}' data-email="${req.email}" data-event="${req.category === 'life_event' ? req.originalData.eventType : 'profile'}" data-empname="${req.name}" style="margin-right: 15px; cursor: pointer;">
            
            <div style="flex: 1.5; font-size: 14px; font-weight: bold; color: #333;">
              👤 ${req.name}<br><span style="font-size: 11px; color: #888; font-weight: normal;">ID: ${req.empId}</span>
            </div>
            <div style="flex: 2;">
              <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${req.title}</span>
            </div>
            <div style="width: 100px; text-align: center; font-size: 12px; color: #666;">${req.date}</div>
            <div class="toggle-icon" style="width: 80px; text-align: center; color: #0056b3; font-size: 12px; font-weight: bold;">▼ 詳細</div>
          </div>

          <div class="req-detail" style="display: none; padding: 15px 15px 20px 45px; background: #fafafa; border-top: 1px dashed #e5e7eb;">
            ${detailHtml}
            <div style="text-align: right; margin-top: 15px;">
              <button class="btn-approve-single" 
                      data-val="${req.id}"
                      data-options='${JSON.stringify(req.options|| [])}'
                      data-email="${req.email}"
                      data-event="${req.category === 'life_event' ? req.originalData.eventType : 'profile'}"
                      data-empname="${req.name}"
                      style="background: #fff; color: #28a745; border: 1px solid #28a745; padding: 6px 16px; border-radius: 4px; font-size: 13px; font-weight: bold; cursor: pointer; transition: 0.2s;"
                      onmouseover="this.style.background='#28a745'; this.style.color='#fff';"
                      onmouseout="this.style.background='#fff'; this.style.color='#28a745';">
                内容を確認して承認
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    attachReqEvents(); // 先ほど送っていただいた「アコーディオン開閉やチェックボックスの制御」の関数です。そのまま使えます！

  } catch (error) {
    console.error("統合申請の読み込みエラー:", error);
  }
}


  // 4. イベント（アコーディオン・一括承認・フィルター）をセットする関数
  function attachReqEvents() {
    // アコーディオン開閉
    document.querySelectorAll('.req-summary').forEach(summary => {
      summary.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return; // チェックボックスクリック時は無視
        const detail = summary.nextElementSibling as HTMLElement;
        const icon = summary.querySelector('.toggle-icon') as HTMLElement;
        if (detail.style.display === 'none') {
          detail.style.display = 'block';
          if (icon) icon.innerText = '▲ 閉じる';
        } else {
          detail.style.display = 'none';
          if (icon) icon.innerText = '▼ 詳細';
        }
      });
    });

    // フィルター機能
    const reqFilter = document.getElementById('req-filter') as HTMLSelectElement;
    if (reqFilter) {
      reqFilter.addEventListener('change', () => {
        const val = reqFilter.value;
        document.querySelectorAll('.req-row').forEach((row: any) => {
          row.style.display = (val === 'all' || row.getAttribute('data-category') === val) ? 'block' : 'none';
        });
      });
    }

    // チェックボックスと一括承認ボタンの連動
    const checkAll = document.getElementById('req-check-all') as HTMLInputElement;
    const rowChecks = document.querySelectorAll('.req-checkbox') as NodeListOf<HTMLInputElement>;
    const btnBulk = document.getElementById('btn-bulk-approve-req') as HTMLButtonElement;
    const countSpan = document.getElementById('req-selected-count');

    const updateBulkBtn = () => {
      const checkedCount = Array.from(rowChecks).filter(cb => cb.checked).length;
      if (countSpan) countSpan.innerText = checkedCount.toString();
      if (btnBulk) {
        if (checkedCount > 0) {
          btnBulk.disabled = false;
          btnBulk.style.opacity = '1';
          btnBulk.style.cursor = 'pointer';
        } else {
          btnBulk.disabled = true;
          btnBulk.style.opacity = '0.5';
          btnBulk.style.cursor = 'not-allowed';
        }
      }
    };

    if (checkAll) {
      checkAll.addEventListener('change', (e) => {
        const isChecked = (e.target as HTMLInputElement).checked;
        rowChecks.forEach(cb => {
          const row = cb.closest('.req-row') as HTMLElement;
          if (row && row.style.display !== 'none') cb.checked = isChecked;
        });
        updateBulkBtn();
      });
    }

    rowChecks.forEach(cb => cb.addEventListener('change', updateBulkBtn));

// 🌟🌟🌟 神・自動タスク生成エンジン（全申請対応・統合版） 🌟🌟🌟
const executeApproval = async (targets: any[]) => {
  console.log("🚀 承認・タスク化エンジン起動！ 処理件数:", targets.length);
  if (!confirm(`${targets.length}件の申請を承認し、タスクを生成しますか？\n（※住所変更・扶養追加などのマスタは自動更新されます）`)) return;
// 👇 🌟 ここに `window.prompt` のコードを追加します！
const customMessage = window.prompt(
  `${targets.length}件の申請を承認し、タスクを生成します。\n対象者に送る通知メッセージを入力してください：\n（※空白のままOKを押すと標準の定型文が送信されます）`,
  "申請いただいた手続きが労務にて承認され、社内処理が完了しました。"
);

if (customMessage === null) return; // キャンセルなら処理ストップ

  try {
      const currentCompanyId = localStorage.getItem('current_company_id');
      if (!currentCompanyId) {
          alert("会社情報が読み込めません。再読み込みしてください。");
          return;
      }
      
      const taskKey = `hr_tasks_${currentCompanyId}`;
      const tasks = JSON.parse(localStorage.getItem(taskKey) || '[]');

      for (const target of targets) {
          const docId = target.val; 
          const docRef = doc(db, 'changeRequests', docId);
          const docSnap = await getDoc(docRef);
          
          if (!docSnap.exists()) {
              console.warn(`⚠️ 申請データが見つかりません: ${docId}`);
              continue;
          }

          const reqData = docSnap.data();

          if (reqData.companyId && reqData.companyId !== currentCompanyId) {
              console.warn(`🚨 他社のデータアクセスの可能性を検知したためスキップしました。`);
              continue;
          }

          const baseName = reqData.empName || target.empName || '氏名不明';
          const safeDate = reqData.eventDate || reqData.changeDate || new Date().toISOString().split('T')[0];
          const empId = reqData.employeeId;

          // ==========================================
          // 🌟 1. 申請の種類に応じた「タスク生成」＆「マスタ更新」
          // ==========================================
          
          // ▼ ① 住所・氏名変更
          if (reqData.type === '住所・氏名変更') {
              const q = query(collection(db, "users"), where("companyId", "==", currentCompanyId), where("employeeId", "==", empId));
              const empSnapshot = await getDocs(q);
              
              if (!empSnapshot.empty) {
                  const empDoc = empSnapshot.docs[0];
                  if (empDoc) {
                      const updateData: any = {};
                      if (reqData.newZip) updateData.zipCode = reqData.newZip;
                      if (reqData.newAddress) updateData.currentAddress = reqData.newAddress;
                      if (reqData.newPass) updateData['allowances.commute'] = reqData.newPass;
                      if (reqData.newLastName) updateData.lastNameKanji = reqData.newLastName;
                      if (reqData.newFirstName) updateData.firstNameKanji = reqData.newFirstName;
                      await updateDoc(doc(db, "users", empDoc.id), updateData);
                  }
              }

              tasks.push({
                  id: Date.now() + Math.floor(Math.random() * 1000),
                  title: `【役所提出】${baseName}様: 被保険者 住所・氏名変更届`,
                  empName: baseName,
                  agency: '年金事務所',
                  status: 'todo',
                  deadline: new Date(new Date().getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                  source: '従業員申請 (マスタ更新済)',
                  memo: `【承認済】マスタは自動更新されました。\ne-GovからCSVを出力して提出してください。\n（※マイナンバー連携済みの場合は提出不要です）`
              });
          }
          
          // ▼ ② 退職
          else if (reqData.type === '退職') {
              const dep = reqData.dependent || {};
              tasks.push({
                  id: Date.now() + Math.floor(Math.random() * 1000),
                  title: `【役所提出】${baseName}様: 資格喪失届 ＆ 離職票発行`,
                  empName: baseName,
                  agency: '年金事務所 / ハローワーク',
                  status: 'todo',
                  deadline: safeDate,
                  source: '退職申請',
                  memo: `【退職日】${safeDate}\n【保険証返却】${dep.insuranceReturn || '不明'}\n【離職票】${dep.unemploymentSlip || '未選択'}`
              });
          }

          // ▼ ③ 保険証再発行
          else if (reqData.type === '保険証再発行') {
              const dep = reqData.dependent || {};
              tasks.push({
                  id: Date.now() + Math.floor(Math.random() * 1000),
                  title: `【役所提出】${baseName}様: 健康保険 被保険者証再交付申請`,
                  empName: baseName,
                  agency: '年金事務所',
                  status: 'todo',
                  deadline: safeDate,
                  source: '再発行申請',
                  memo: `【理由】${dep.reason || '不明'}\n【警察届出】${dep.policeReport || '不要'}\n【備考】${dep.memo || 'なし'}`
              });
          }

          // ▼ ④ ライフイベント（結婚・出産・扶養など）
          else if (reqData.type === 'ライフイベント') {
              const evType = reqData.eventType;
              const dep = reqData.dependent || {};

              // 扶養を外す
              if (evType === 'remove_family') {
                  tasks.push({
                      id: Date.now() + Math.floor(Math.random() * 1000),
                      title: `【役所提出】${baseName}様: 被扶養者（異動）届（減少）`,
                      empName: baseName,
                      agency: '年金事務所',
                      status: 'todo',
                      deadline: safeDate,
                      source: 'ライフイベント',
                      memo: `【対象】${reqData.targetFamilyName || '不明'}\n【理由】${reqData.removeReason || '不明'}\n【保険証】${reqData.cardReturnStatus || '不明'}`
                  });
              } 
              // 💍 扶養に入れる（★マスタ自動追加搭載！）
              else if (evType === 'marriage' || evType === 'other') {
                  // 1. タスク生成
                  tasks.push({
                      id: Date.now() + Math.floor(Math.random() * 1000),
                      title: `【役所提出】${baseName}様: 被扶養者（異動）届（増加）`,
                      empName: baseName,
                      agency: '年金事務所',
                      status: 'todo',
                      deadline: safeDate,
                      source: 'ライフイベント',
                      memo: `【追加家族】${dep.lastNameKanji} ${dep.firstNameKanji} (${dep.relation})`
                  });

                  // 2. 社員マスタ（users）に家族データを追加
                  const q = query(collection(db, "users"), where("companyId", "==", currentCompanyId), where("employeeId", "==", empId));
                  const empSnapshot = await getDocs(q);
                  
                  if (!empSnapshot.empty) {
                      const empDoc = empSnapshot.docs[0];
                      if (empDoc) {
                          // 🌟 arrayUnionを使って、既存の家族配列（dependents）に安全にドッキング！
                          await updateDoc(doc(db, "users", empDoc.id), {
                              dependents: arrayUnion({
                                  lastNameKanji: dep.lastNameKanji || '',
                                  firstNameKanji: dep.firstNameKanji || '',
                                  lastNameKana: dep.lastNameKana || '',
                                  firstNameKana: dep.firstNameKana || '',
                                  birthDate: dep.birthDate || '',
                                  relation: dep.relation || '',
                                  income: dep.income || '',
                                  livingStatus: dep.livingStatus || '',
                                  addedAt: new Date().toISOString()
                              })
                          });
                      }
                  }
              }
 // ▼ 出産（オプションに応じて最大5つのタスクを生成！）
 else if (evType === 'birth') {
  // 🌟 過去のデータや画面のデータなど、どこからでも確実に拾う超・安全設計！
  const dbOpts = reqData.supportOptions || reqData.options || [];
  const opts = dbOpts.length > 0 ? dbOpts : (target.options || []);

  if (opts.includes('allowance')) {
      tasks.push({
          id: Date.now() + Math.floor(Math.random() * 1000) + 1,
          title: `【役所提出】${baseName}様: 出産手当金 支給申請書`,
          empName: baseName,
          agency: '健保組合',
          status: 'todo',
          deadline: safeDate,
          source: 'ライフイベント'
      });
  }
// ▼ 産休・育休の免除申請（タスク生成 ＋ マスタの免除フラグON！）
if (opts.includes('exemption') || opts.includes('sankyu_exemption')) {
  // 1. カンバンタスクの生成
  tasks.push({
      id: Date.now() + Math.floor(Math.random() * 1000) + 2,
      title: `【役所提出】${baseName}様: 産前産後休業/育児休業等 取得者申出書`,
      empName: baseName,
      agency: '年金事務所',
      status: 'todo',
      deadline: safeDate,
      source: 'ライフイベント'
  });

  // 🌟 2. 追加！社員マスタ（users）に「社会保険料免除フラグ」を立てる！
  const q = query(collection(db, "users"), where("companyId", "==", currentCompanyId), where("employeeId", "==", empId));
  const empSnapshot = await getDocs(q);
  
  if (!empSnapshot.empty) {
      const empDoc = empSnapshot.docs[0];
      if (empDoc) {
          await updateDoc(doc(db, "users", empDoc.id), {
              isSocialInsuranceExempt: true, // 💡 これが給与計算を0円にする最強のフラグ！
              leaveStatus: '休業中(免除)'  // 💡 バッジ表示用のステータス
          });
      }
  }
}
  if (opts.includes('hellowork')) {
      tasks.push({
          id: Date.now() + Math.floor(Math.random() * 1000) + 3,
          title: `【役所提出】${baseName}様: 育児休業給付金 支給申請書`,
          empName: baseName,
          agency: 'ハローワーク',
          status: 'todo',
          deadline: safeDate,
          source: 'ライフイベント'
      });
  }
  if (opts.includes('monthly_change')) {
      tasks.push({
          id: Date.now() + Math.floor(Math.random() * 1000) + 4,
          title: `【役所提出】${baseName}様: 育児休業等終了時 報酬月額変更届`,
          empName: baseName,
          agency: '年金事務所',
          status: 'todo',
          deadline: safeDate,
          source: 'ライフイベント'
      });
  }
  if (opts.includes('pension_special')) {
      tasks.push({
          id: Date.now() + Math.floor(Math.random() * 1000) + 5,
          title: `【役所提出】${baseName}様: 養育期間 標準報酬月額特例申出書`,
          empName: baseName,
          agency: '年金事務所',
          status: 'todo',
          deadline: safeDate,
          source: 'ライフイベント'
      });
  }
}
          }

          // ==========================================
          // 🌟 2. 申請のステータスを「承認済み」に変更
          // ==========================================
          await updateDoc(docRef, { status: 'approved' }); 

          // ==========================================
          // 🌟 3. 従業員への自動通知（定型文）を発行！
          // ==========================================
          const reqTypeLabel = reqData.type === 'ライフイベント' ? reqData.eventTitle : reqData.type;
          
          await addDoc(collection(db, "notifications"), {
              companyId: currentCompanyId,
              targetUserId: reqData.userId || "",       // 🔥 UIDで確実な紐付け！
              targetEmployeeId: empId || "",            // 🔥 社員番号で確実な紐付け！
              targetEmpName: baseName,                  // 画面表示用
              title: "✅ 申請が承認されました",
              message: `申請いただいた「${reqTypeLabel}」の手続きが労務にて承認され、社内処理が完了しました。`,
              isArchived: false,
              createdAt: serverTimestamp()
          });

      } // ループ終了

      localStorage.setItem(taskKey, JSON.stringify(tasks));
      
      alert("🌟 承認完了！\n選択した申請をタスク化し、対象者への通知を送信しました！");
      location.reload(); 

  } catch (error) {
      console.error("承認処理エラー:", error);
      alert("承認処理中にエラーが発生しました。");
  }
};
    // 個別ボタンの動作
    document.querySelectorAll('.btn-approve-single').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = {
          val: btn.getAttribute('data-val'),
          options: JSON.parse(btn.getAttribute('data-options') || '[]'),
          event: btn.getAttribute('data-event'),
          empName: btn.getAttribute('data-empname'),
          eventDate: btn.getAttribute('data-eventdate')
        };
        executeApproval([target]);
      });
    });

    // 一括ボタンの動作
    if (btnBulk) {
      btnBulk.addEventListener('click', () => {
        const targets: any[] = [];
        rowChecks.forEach(cb => {
          if (cb.checked) {
            targets.push({
              val: cb.value,
              options: JSON.parse(cb.getAttribute('data-options') || '[]'),
              event: cb.getAttribute('data-event'),
              empName: cb.getAttribute('data-empname'),
              eventDate: cb.getAttribute('data-eventdate')
            });
          }
        });
        if (targets.length > 0) executeApproval(targets);
      });
    }
  }


  // ==========================================
  // 【パート2】複数年齢の自動検知（一括処理・ソート機能付きUI）
  // ==========================================
  // （以下、竹高さんが作成した既存の機能はそのまま1文字も変えずに維持します）
  let ageEventUsers = await fetchAgeEventEmployees();
  let currentFilter = 'all'; // 現在のフィルター状態（all, 40, 70, 75）
  let selectedIds: string[] = []; // チェックされた対象者を保存する箱

  const container = document.getElementById('kaigo-alert-container');
  const badge = document.getElementById('alert-badge');

  function renderEventTable() {
    if (badge) badge.innerText = `今月の要対応: ${ageEventUsers.length}件`;
    if (!container) return;

    if (ageEventUsers.length === 0) {
      container.innerHTML = `
        <div style="background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px; padding: 20px; text-align: center; color: #666;">
          🎉 現在、要対応の年齢到達アラートはありません。
        </div>
      `;
      return;
    }

    const filteredUsers = ageEventUsers.filter(u => currentFilter === 'all' || u.age.toString() === currentFilter);

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; background: #f8f9fa; padding: 10px 15px; border-radius: 6px; border: 1px solid #e5e7eb;">
        <div>
          <label style="font-size: 13px; font-weight: bold; color: #4b5563; margin-right: 10px;">🏷️ カテゴリー:</label>
          <select id="event-filter" style="padding: 6px 10px; border-radius: 4px; border: 1px solid #d1d5db; font-size: 13px; outline: none; cursor: pointer;">
            <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>すべて表示</option>
            <option value="40" ${currentFilter === '40' ? 'selected' : ''}>40歳 (介護保険該当)</option>
            <option value="65" ${currentFilter === '65' ? 'selected' : ''}>65歳 (天引き終了)</option>
            <option value="70" ${currentFilter === '70' ? 'selected' : ''}>70歳 (厚生年金喪失)</option>
            <option value="75" ${currentFilter === '75' ? 'selected' : ''}>75歳 (後期高齢者)</option>
          </select>
        </div>
        <button id="btn-bulk-gen" disabled style="background: #28a745; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; opacity: 0.5; cursor: not-allowed; transition: 0.2s;">
          ⚡ 選択したタスクを一括生成 (<span id="selected-count">${selectedIds.length}</span>)
        </button>
      </div>
    `;

    html += `
      <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
              <th style="padding: 12px 10px; text-align: center; width: 40px;"><input type="checkbox" id="check-all" style="cursor: pointer;"></th>
              <th style="padding: 12px 10px; text-align: left; color: #4b5563;">対象者</th>
              <th style="padding: 12px 10px; text-align: left; color: #4b5563;">イベント内容</th>
              <th style="padding: 12px 10px; text-align: left; color: #4b5563;">年齢到達日</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (filteredUsers.length === 0) {
      html += `<tr><td colspan="4" style="text-align:center; padding: 30px; color:#9ca3af;">このカテゴリーに該当する従業員はいません。</td></tr>`;
    } else {
      filteredUsers.forEach((target) => {
        const uniqueVal = `${target.docId}__${target.flagName}`;
        const isChecked = selectedIds.includes(uniqueVal) ? 'checked' : '';
        
        const badgeBg = target.age === 40 ? '#dcfce7' : 
        target.age === 65 ? '#ffedd5' : 
        target.age === 70 ? '#e0f2fe' : '#ede9fe';

        const badgeColor = target.age === 40 ? '#15803d' : 
        target.age === 65 ? '#ea580c' : 
        target.age === 70 ? '#0369a1' : '#6d28d9';

        html += `
          <tr style="border-bottom: 1px solid #f3f4f6;">
            <td style="padding: 12px 10px; text-align: center;">
              <input type="checkbox" class="row-checkbox" value="${uniqueVal}" ${isChecked} style="cursor: pointer;">
            </td>
            <td style="padding: 12px 10px;">
              <div style="font-weight: bold; color: #111827;">${target.name}</div>
              <div style="font-size: 11px; color: #6b7280;">(${target.birthdate} 生)</div>
            </td>
            <td style="padding: 12px 10px;">
              <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; border: 1px solid ${badgeColor}40;">
                ${target.age}歳: ${target.eventTitle}
              </span>
            </td>
            <td style="padding: 12px 10px; color: #4b5563;">${target.reachDate}</td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    attachTableEvents();
  }

  function attachTableEvents() {
    const filterSelect = document.getElementById('event-filter') as HTMLSelectElement;
    const checkAll = document.getElementById('check-all') as HTMLInputElement;
    const rowCheckboxes = document.querySelectorAll('.row-checkbox') as NodeListOf<HTMLInputElement>;
    const btnBulkGen = document.getElementById('btn-bulk-gen') as HTMLButtonElement;
    const selectedCount = document.getElementById('selected-count');

    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        currentFilter = (e.target as HTMLSelectElement).value;
        selectedIds = []; 
        renderEventTable();
      });
    }

    const updateBulkButton = () => {
      if (btnBulkGen && selectedCount) {
        selectedCount.innerText = selectedIds.length.toString();
        if (selectedIds.length > 0) {
          btnBulkGen.disabled = false;
          btnBulkGen.style.opacity = '1';
          btnBulkGen.style.cursor = 'pointer';
        } else {
          btnBulkGen.disabled = true;
          btnBulkGen.style.opacity = '0.5';
          btnBulkGen.style.cursor = 'not-allowed';
        }
      }
    };

    if (checkAll) {
      checkAll.addEventListener('change', (e) => {
        const isChecked = (e.target as HTMLInputElement).checked;
        selectedIds = [];
        rowCheckboxes.forEach(cb => {
          cb.checked = isChecked;
          if (isChecked) selectedIds.push(cb.value);
        });
        updateBulkButton();
      });
    }

    rowCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
          if (!selectedIds.includes(target.value)) selectedIds.push(target.value);
        } else {
          selectedIds = selectedIds.filter(id => id !== target.value); 
        }
        if (checkAll) checkAll.checked = selectedIds.length === rowCheckboxes.length && rowCheckboxes.length > 0;
        updateBulkButton();
      });
    });

    if (btnBulkGen) {
      btnBulkGen.addEventListener('click', async () => {
        if (selectedIds.length === 0) return;

        btnBulkGen.innerText = '⏳ 一括処理中...';
        btnBulkGen.disabled = true;

        try {
          // 🌟 1. 会社IDを取得して専用キーを作成！
          const currentCompanyId = localStorage.getItem('current_company_id');
          const taskKey = currentCompanyId ? `hr_tasks_${currentCompanyId}` : 'hr_tasks';

          // 🌟 2. 専用キーで読み込み！
          const tasks = JSON.parse(localStorage.getItem(taskKey) || '[]');
          
          for (const uniqueVal of selectedIds) {
            const [docId, flagName] = uniqueVal.split('__');
            if (!docId || !flagName) continue;

            await updateDoc(doc(db, 'users', docId), { [flagName]: true });

            const targetUser = ageEventUsers.find(u => u.docId === docId && u.flagName === flagName);
            if (targetUser) {
              tasks.push({
                id: Date.now() + Math.floor(Math.random() * 1000), 
                title: targetUser.taskTitle,
                empName: targetUser.name,
                source: `自動検知(${targetUser.age}歳到達)`,
                deadline: '当月末まで',
                status: 'todo',
                agency: getAgencyByTaskTitle(targetUser.taskTitle)
              });
            }
          }

          // 🌟 3. 専用キーで保存！
          localStorage.setItem(taskKey, JSON.stringify(tasks));
          alert(`✅ ${selectedIds.length}件のタスクを一括生成し、集中管理へ送りました！`);

          ageEventUsers = ageEventUsers.filter(u => !selectedIds.includes(`${u.docId}__${u.flagName}`));
          selectedIds = [];
          renderEventTable();

        } catch (err) {
          console.error("タスク一括生成エラー:", err);
          alert("エラーが発生しました。");
          btnBulkGen.innerText = `⚡ 選択したタスクを一括生成 (${selectedIds.length})`;
          btnBulkGen.disabled = false;
        }
      });
    }
  }

  renderEventTable();
}

async function fetchAgeEventEmployees() {
  // 🌟 4. 会社IDを取得！
  const currentCompanyId = localStorage.getItem('current_company_id');
  if (!currentCompanyId) return []; // 会社情報がなければ空配列を返す

  // 🌟 5. 【超重要】従業員を検索する時は必ず「自分の会社」だけで絞り込む！！！
  const q = query(collection(db, 'users'), where("companyId", "==", currentCompanyId));
  const usersSnap = await getDocs(q);
  
  const targets: any[] = [];
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); 

  const ageMilestones = [
    { age: 40, title: '介護保険 第2号被保険者該当', taskTitle: '【重要】介護保険料の徴収開始に関するご案内と給与確認' },
    { age: 65, title: '介護保険 給与天引き終了', taskTitle: '【重要】介護保険料の給与天引き終了に関するご案内' },
    { age: 70, title: '厚生年金保険 資格喪失', taskTitle: '【重要】厚生年金喪失の案内および健康保険同日得喪の確認' },
    { age: 75, title: '後期高齢者医療制度 該当', taskTitle: '【重要】後期高齢者医療への移行と健康保険喪失手続き' }
  ];

  usersSnap.forEach((uSnap) => {
    const emp = uSnap.data();
    if (!emp.birthdate) return;
    const birthDate = new Date(emp.birthdate);

    ageMilestones.forEach(milestone => {
      const flagName = `age${milestone.age}TaskDone`;
      if (emp[flagName] === true) return;

      const milestoneBirthday = new Date(birthDate.getFullYear() + milestone.age, birthDate.getMonth(), birthDate.getDate());
      const reachAgeDate = new Date(milestoneBirthday.getTime() - 24 * 60 * 60 * 1000);

      if (reachAgeDate.getFullYear() === currentYear && reachAgeDate.getMonth() === currentMonth) {
        targets.push({
          docId: uSnap.id,
          name: `${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''}`.trim(),
          birthdate: emp.birthdate,
          reachDate: reachAgeDate.toLocaleDateString('ja-JP'),
          age: milestone.age,
          eventTitle: milestone.title,
          taskTitle: milestone.taskTitle,
          flagName: flagName
        });
      }
    });
  });

  return targets;
}

function getAgencyByTaskTitle(title: string): string {
    if (title.includes('厚生年金喪失') || title.includes('後期高齢者')) return '年金事務所';
    if (title.includes('介護保険')) return '社内'; 
    return '従業員本人 / 社内';
}


// ============================================================================
// 🌟🌟🌟 労務手動登録パネルの制御ロジック（デバッグ監視カメラ付き！） 🌟🌟🌟
// ============================================================================

export async function setupManualEventPanel() {
  console.log("🚀 [Debug] setupManualEventPanel が実行されました！");

  const currentCompanyId = localStorage.getItem('current_company_id');
  console.log("🏢 [Debug] 現在の会社ID (localStorage):", currentCompanyId);

  if (!currentCompanyId) {
      console.error("❌ [Debug] 会社IDが取得できないため、ここで処理を強制終了します！");
      return;
  }

  const empSelect = document.getElementById('manual-event-emp') as HTMLSelectElement;
  const typeSelect = document.getElementById('manual-event-type') as HTMLSelectElement;
  const startDateInput = document.getElementById('event-start-date') as HTMLInputElement;
  const endDateInput = document.getElementById('event-end-date') as HTMLInputElement;
  const endDateContainer = document.getElementById('event-end-date-container') as HTMLDivElement;
  const dateLabel = document.getElementById('event-date-label') as HTMLLabelElement;
  const btnSubmitManual = document.getElementById('btn-submit-manual-event') as HTMLButtonElement;

  console.log("🔍 [Debug] プルダウン要素(empSelect)の取得結果:", empSelect);

  // ① 従業員リストの読み込み
  if (empSelect) {
      try {
          console.log("📡 [Debug] Firestoreの 'users' コレクションへ検索リクエストを送信します...");
          const q = query(collection(db, 'users'), where('companyId', '==', currentCompanyId));
          const snapshot = await getDocs(q);
          
          console.log(`✅ [Debug] データ取得完了！ 取得できた従業員数: ${snapshot.size} 件`);

          if (snapshot.empty) {
              console.warn("⚠️ [Debug] 検索結果が0件です。会社IDが一致するユーザーがいません。");
          }

          empSelect.innerHTML = '<option value="">選択してください...</option>';
          snapshot.forEach(doc => {
              const data = doc.data();
              const empName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
              console.log(`👤 [Debug] プルダウンに追加: ${empName} (ドキュメントID: ${doc.id})`);
              
              const option = document.createElement('option');
              option.value = doc.id; 
              option.textContent = `${data.employeeId || 'ID未設定'} : ${empName}`;
              empSelect.appendChild(option);
          });
      } catch (error) {
          console.error("❌ [Debug] Firestoreへのアクセス中にエラーが発生:", error);
      }
  } else {
      console.error("❌ [Debug] HTML内に 'manual-event-emp' のIDを持つ要素が存在しません！（HTMLの描画より先にJSが走っている可能性があります）");
  }

  // ② 連動ギミックの監視
  if (typeSelect) {
      typeSelect.addEventListener('change', () => {
          console.log("🔄 [Debug] イベント種類が切り替わりました:", typeSelect.value);
          const val = typeSelect.value;
          if (val === 'maternity_leave') {
              dateLabel.innerText = '📅 休業期間（開始日 〜 終了予定日）';
              endDateContainer.style.display = 'flex';
          } else if (val === 'return_work') {
              dateLabel.innerText = '🌸 復職日';
              endDateContainer.style.display = 'none';
              endDateInput.value = '';
          } else {
              dateLabel.innerText = '📅 発生日 / 変更日';
              endDateContainer.style.display = 'none';
              endDateInput.value = '';
          }
      });
  }

// ③ 登録ボタンの処理
if (btnSubmitManual) {
  btnSubmitManual.onclick = async () => {
      console.log("👆 [Debug] イベント登録ボタンが押されました！");
      
      const empId = empSelect.value;
      const eventType = typeSelect.value;
      const startDate = startDateInput.value;
      const endDate = endDateInput.value;

      // 1. 未入力チェック
      if (!empId || !eventType || !startDate) {
          alert("⚠️ 対象の従業員、イベント種類、開始日を入力してください。");
          return;
      }

      if (!confirm('この内容でイベントを登録し、対象者のステータスを更新しますか？\n（※タスクの生成は行われません）')) return;

      try {
          // 🌟 empId には直接ドキュメントIDが入っているので、直接アクセスできる！
          const userRef = doc(db, 'users', empId);

          // 2. イベントごとのマスタ更新処理
          if (eventType === 'maternity_leave') {
              // 👶 産休・育休の開始：最強の「免除フラグ」をONにする！
              await updateDoc(userRef, {
                  issocialInsuranceExempt: true, // 💡 これで給与計算が0円になる！
                  leaveStatus: '休業中(免除)',
                  leaveStartDate: startDate,
                  leaveEndDate: endDate || null,
                  updatedAt: new Date()
              });
              alert("✅ 産休・育休を手動登録し、社会保険料の【免除設定をON】にしました！\n（給与計算時に保険料が0円として計算されます）");

          } else if (eventType === 'return_work') {
              // 🌸 復職：免除フラグをOFFに戻す！（これがないと永遠に0円になってしまいます）
              await updateDoc(userRef, {
                  isSocialInsuranceExempt: false, // 💡 免除終了、通常計算に戻る
                  leaveStatus: '在籍',
                  leaveStartDate: null,
                  leaveEndDate: null,
                  updatedAt: new Date()
              });
              alert("✅ 復職を手動登録し、社会保険料の【免除設定を解除】しました！\n（次回の給与計算から通常の保険料が引かれます）");

          } else {
              // その他のイベントの場合
              await updateDoc(userRef, { updatedAt: new Date() });
              alert("✅ イベントを登録しました！");
          }

          // 3. フォームのリセット
          empSelect.value = '';
          typeSelect.value = '';
          startDateInput.value = '';
          endDateInput.value = '';
          endDateContainer.style.display = 'none';
          dateLabel.innerText = '📅 発生日 / 変更日';

      } catch (error) {
          console.error("❌ [Debug] マスタ更新エラー:", error);
          alert("⚠️ データベースの更新中にエラーが発生しました。");
      }
  };
}
}
