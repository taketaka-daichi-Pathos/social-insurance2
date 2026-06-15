import { collection, getDocs, doc, updateDoc, query, where, getDoc } from 'firebase/firestore';
import { db } from './config/firebase.js'; // ※ご自身の環境に合わせてください

export async function initLifeEventUI() {
  console.log("🎉 ライフイベント画面（一括処理＆タスク自動生成版）が正常に読み込まれました！");


// ==========================================
  // 【パート1】従業員からの申請（統合版：名前変換・アコーディオン・一括承認）
  // ==========================================
  await loadUnifiedRequests(); // 画面を開いた時にデータを読み込む！

  async function loadUnifiedRequests() {
    // 🌟 HTML側の正しい箱（unified-request-container）を指定！
    const container = document.getElementById('unified-request-container');
    const badge = document.getElementById('request-badge');
    
    if (!container) {
      console.error("エラー: unified-request-container がHTMLに見つかりません");
      return;
    }

    try {
      // 1. ユーザー辞書作成（メールアドレス・IDから名前を引くため）
      const usersSnap = await getDocs(collection(db, 'users'));
      const userDict: any = {};
      usersSnap.forEach(u => {
        const data = u.data();
        const fullName = `${data.lastNameKanji || ''} ${data.firstNameKanji || ''}`.trim();
        if (data.email) userDict[data.email] = fullName;
        if (data.employeeId) userDict[data.employeeId] = fullName;
      });

      // 2. 「ライフイベント」と「住所変更」の両方を取得！
      const qLife = query(collection(db, 'life_events'), where('status', '==', '未承認'));
      const qChange = query(collection(db, 'changeRequests'), where('status', '==', 'pending'));
      
      const [snapLife, snapChange] = await Promise.all([getDocs(qLife), getDocs(qChange)]);
      let allRequests: any[] = [];

      // ライフイベントデータの整形
      snapLife.forEach(d => {
        const data = d.data();
        allRequests.push({
          id: d.id,
          dbType: 'life_events',
          category: 'life_event',
          title: data.eventTitle,
          email: data.userEmail,
          empId: data.employeeId || '未設定',
          name: userDict[data.userEmail] || userDict[data.employeeId] || data.userEmail || '名称未設定',
          date: data.createdAt ? data.createdAt.toDate().toLocaleDateString('ja-JP') : '日付不明',
          rawDate: data.createdAt ? data.createdAt.toMillis() : 0,
          options: data.supportOptions || [],
          eventDate: data.eventDate || '',
          originalData: data
        });
      });

      // 住所・氏名変更データの整形
      snapChange.forEach(d => {
        const data = d.data();
        allRequests.push({
          id: d.id,
          dbType: 'changeRequests',
          category: 'profile',
          title: '住所・氏名変更',
          email: '', 
          empId: data.employeeId || '未設定',
          name: userDict[data.employeeId] || '名称未設定',
          date: data.createdAt ? new Date(data.createdAt).toLocaleDateString('ja-JP') : '日付不明',
          rawDate: data.createdAt ? new Date(data.createdAt).getTime() : 0,
          options: [],
          eventDate: data.changeDate || '',
          originalData: data
        });
      });

      // 日付が新しい順に並び替え
      allRequests.sort((a, b) => b.rawDate - a.rawDate);

      if (badge) badge.innerText = `未承認: ${allRequests.length}件`;

      // 0件の時の表示
      if (allRequests.length === 0) {
        container.innerHTML = `<div style="padding: 30px; text-align: center; color: #888;">📝 現在、未承認の申請はありません。</div>`;
        return;
      }

      // 3. データの描画（アコーディオン形式）
      let html = '';
      allRequests.forEach(req => {
        let detailHtml = '';
        if (req.dbType === 'life_events') {
          detailHtml = `<p style="margin:0 0 5px; font-weight:bold; color:#d84315;">📅 予定日: ${req.eventDate}</p>`;

            // 👇👇👇 🌟 ここから追加！ 🌟 👇👇👇
            const evType = req.originalData.eventType;
                    
            // 1. 👋 扶養喪失（外す）の表示
            if (evType === 'remove_family') {
                detailHtml += `<div style="margin-top: 5px; font-size: 13px; color: #333;">
                    対象: <strong>${req.originalData.targetFamilyName || '不明'}</strong><br>
                    理由: ${req.originalData.removeReason || '不明'}<br>
                    <span style="color: #d32f2f; font-weight: bold;">保険証の状況: ${req.originalData.cardReturnStatus || '未回答'}</span>
                </div>`;
            } 
            // 2. 💍 扶養追加（結婚・その他）の表示
            else if (evType === 'marriage' || evType === 'other') {
                const dep = req.originalData.dependent || {};
                detailHtml += `<div style="margin-top: 5px; font-size: 13px; color: #333;">
                    追加する家族: <strong>${dep.lastNameKanji || ''} ${dep.firstNameKanji || ''}</strong> (${dep.relation || '不明'})
                </div>`;
            }

            // 3. 📎 添付ファイルがある場合はリンクを表示（全ライフイベント共通）
            if (req.originalData.attachedFiles && req.originalData.attachedFiles.length > 0) {
                detailHtml += `<div style="margin-top: 8px; font-size: 12px; background: #e3f2fd; padding: 6px; border-radius: 4px;">📎 添付書類: `;
                req.originalData.attachedFiles.forEach((file: any) => {
                    detailHtml += `<a href="${file.fileUrl}" target="_blank" style="color: #0056b3; margin-right: 12px; text-decoration: underline; font-weight: bold;">📄 ${file.docName}</a>`;
                });
                detailHtml += `</div>`;
            }
            // 👆👆👆 🌟 追加ここまで！ 🌟 👆👆👆

          if (req.options.length > 0) {
            detailHtml += `<ul style="margin: 5px 0 0; padding-left: 20px; font-size: 12px; color: #555;">`;
            req.options.forEach((opt: string) => {
              const label = opt === 'allowance' ? '💰 出産手当金の申請' : opt === 'exemption' ? '🆓 産休・育休の保険料免除' : opt === 'hellowork' ? '🏢 育児休業給付金の申請' : opt === 'monthly_change' ? '🛡️ 育休終了時 報酬月額変更' : opt === 'pension_special' ? '👴 養育期間 標準報酬特例' : opt;
              detailHtml += `<li>${label}</li>`;
            });
            detailHtml += `</ul>`;
          } else {
            detailHtml += `<p style="margin:0; font-size:12px; color:#666;">（必要なサポート手続きの選択はありません）</p>`;
          }
        } else {
          detailHtml = `<p style="margin:0 0 5px; font-weight:bold; color:#0056b3;">📅 変更発生日: ${req.eventDate}</p>
            <div style="font-size:12px; color:#555; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div><strong>新氏名:</strong> ${req.originalData.newLastName || ''} ${req.originalData.newFirstName || ''}</div>
              <div><strong>新住所:</strong> 〒${req.originalData.newZip || ''} ${req.originalData.newAddress || ''}</div>
              <div><strong>新通勤経路:</strong> ${req.originalData.newRoute || '変更なし'}</div>
              <div><strong>新定期代:</strong> ${req.originalData.newPass ? req.originalData.newPass.toLocaleString() + ' 円' : '変更なし'}</div>
            </div>`;
        }

        const badgeColor = req.category === 'life_event' ? '#fd7e14' : '#0d6efd';
        const badgeBg = req.category === 'life_event' ? '#fff3cd' : '#cfe2ff';

        html += `
          <div class="req-row" data-category="${req.category}" style="border-bottom: 1px solid #f3f4f6;">
            <div class="req-summary" style="display: flex; align-items: center; padding: 12px 15px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='transparent'">
              <input type="checkbox" class="req-checkbox" value="${req.id}__${req.dbType}" data-options='${JSON.stringify(req.options)}' data-email="${req.email}" data-event="${req.category === 'life_event' ? req.originalData.eventType : 'profile'}" data-empname="${req.name}" style="margin-right: 15px; cursor: pointer;">
              
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
                        data-val="${req.id}__${req.dbType}"
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
      attachReqEvents(); 

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

// 🌟 神・自動タスク生成エンジン（完全版）
const executeApproval = async (targets: any[]) => {
    console.log("🚀 一括承認スタート！処理件数:", targets.length);
    if (!confirm(`${targets.length}件の申請を承認し、タスクを生成しますか？`)) return;

    try {
        
        const tasks = JSON.parse(localStorage.getItem('hr_tasks') || '[]');

        for (const target of targets) {

            
            // 1. IDとDBタイプの抽出（この3行に差し替えてください）
            const dbType = target.val.includes('life_events') ? 'life_events' : 'changeRequests';
            let docId = target.val;
            if (docId.includes('/')) docId = docId.split('/').pop() || "";
            docId = docId.replace('_life_events', '').replace('_changeRequests', '');
            docId = docId.replace(/_+$/, ""); 
        
            // 2. ここで宣言しているから、これ以降の行でいつでも使えます！
            const baseName = target.empName || '氏名不明';
            const safeDate = target.eventDate || new Date().toISOString().split('T')[0];
        
            // 3. Firebase更新（ここで docId や docRef を使う）
            const docRef = doc(db, dbType, docId);
            const docSnap = await getDoc(docRef);
            let fetchedEventData: any = {};
        
            if (docSnap.exists()) {
                fetchedEventData = docSnap.data();
                await updateDoc(docRef, { status: '承認済' });

            // 🌟 ここから追加：保険証再発行の場合のタスク生成
            if (fetchedEventData.event === 'insurance_reissue') {
                // 先ほどFirebaseに送った詳細情報（理由や警察への届け出など）を取り出す
                const reissueInfo = fetchedEventData.dependent || {}; 

                tasks.push({
                    id: Date.now() + 22, // 統一: Date.now() + 数字の形式
                    title: '【役所提出】健康保険 被保険者証再交付申請書', // 統一: 氏名は入れない
                    empName: baseName,
                    source: 'ライフイベント申請', // 統一: カンバンのラベル用に追加
                    deadline: safeDate,
                    status: 'todo',
                    agency: '年金事務所',
                    memo: `【申請理由】${reissueInfo.reason || '不明'}\n【警察届出】${reissueInfo.policeReport || '-'}\n【備考】${reissueInfo.memo || 'なし'}`
                });
            }
            // 🌟 ここまで追加

            // 👶 出産
            else if (target.event === 'birth') {
             // 🌟 安全装置：optionsが配列でない場合は空配列にする
                const opts = Array.isArray(target.options) ? target.options : [];
                
                console.log("🍼 出産タスク生成開始。オプション:", opts);

                if (target.options.includes('allowance')) 
                    tasks.push({ id: Date.now() + 1, 
                  　title: `【役所提出】健康保険 出産手当金支給申請書`, 
                  　empName: baseName, 
                  　source: 'ライフイベント申請', 
                  　deadline: safeDate, 
                  　status: 'todo', 
                  　agency: '健保組合',
                  　dependent: fetchedEventData.dependent || {}
                });

                if (target.options.includes('exemption')) 
                    tasks.push({ id: Date.now() + 2, 
                  　title: `【役所提出】育児休業等取得者申出書`, 
                  　empName: baseName, source: 'ライフイベント申請', 
                  　deadline: safeDate, status: 'todo', agency: '年金事務所',
                    startDate: target.startDate || "",
                    endDate: target.endDate || ""
                 });


                if (target.options.includes('hellowork')) 
                    tasks.push({ id: Date.now() + 3,
                  　title: `【役所提出】雇用保険 育児休業給付金支給申請書`, 
                  　empName: baseName, 
                  　source: 'ライフイベント申請', 
                  　deadline: safeDate, 
                  　status: 'todo', 
                  　agency: 'ハローワーク' });

                  // 🌟 今回新しく追加するブロック：産前産後休業（産休）の保険料免除タスク
            if (opts.includes('sankyu_exemption')) {
              tasks.push({ 
                  id: Date.now() + 4, // 既存の1,2,3と被らないように +4 にしています
                  title: '【役所提出】産前産後休業取得者申出書',
                  empName: baseName,
                  source: 'ライフイベント申請',
                  deadline: safeDate,
                  status: 'todo',
                  agency: '年金事務所',
                  // 🌟 超重要！さっき作ったCSVエンジンが拾えるように日付データをタスクに埋め込む
                  expectedBirthDate: target.eventDate, 
                  startDate: target.startDate || "",  // 🌟 ここでタスクに持たせる！
                  endDate: target.endDate || ""       // 🌟 ここでタスクに持たせる！
                  // startDate: target.startDate || "", // ※もし画面で産休開始日などを入力させていればここに入れる
                  // endDate: target.endDate || ""
              });
          }
            }
            // 🏠 氏名・住所変更
            else if (target.event === 'profile') {
                tasks.push({ id: Date.now() + 4, title: `【役所提出】健康保険 被保険者氏名変更（訂正）届 / 住所変更届`, empName: baseName, source: '住所・氏名変更', deadline: safeDate, status: 'todo', agency: '年金事務所' });
            }
            // 🔙 復職
            else if (target.event === 'reinstatement') {
                let returnDateStr = target.eventDate;
                if (!returnDateStr || returnDateStr.trim() === '' || returnDateStr === 'undefined') {
                    returnDateStr = new Date().toISOString().split('T')[0];
                }
                tasks.push({ id: Date.now() + 6, title: `【システム処理】復職に伴う社会保険料の控除再開`, empName: baseName, source: 'ライフイベント(復職)', deadline: returnDateStr, status: 'todo', agency: '社内' });
                tasks.push({ id: Date.now() + 7, title: `【役所提出】育児休業等終了時報酬月額変更届`, empName: baseName, source: '復職申請', deadline: returnDateStr, status: 'todo', agency: '年金事務所' });
                
                const cName = fetchedEventData.childName || '未登録';
                const cDob = fetchedEventData.childBirthDate || '未登録';
                tasks.push({ id: Date.now() + 8, title: `【役所提出】養育期間標準報酬月額特例申出書`, empName: baseName, childName: cName, childBirthDate: cDob, source: '復職申請', deadline: returnDateStr, status: 'todo', agency: '年金事務所' });
            }
            // 💍 扶養追加（結婚・その他）
            // 🌟 修正：再発行(insurance_reissue)と退社(resignation)の場合は、ここをスルーさせる
　　　　　　　else if ((target.event === 'marriage' || target.event === 'other' || target.event === 'family_add') && fetchedEventData.event !== 'insurance_reissue' && fetchedEventData.event !== 'resignation') {
                if (target.event === 'marriage') {
                    tasks.push({ id: Date.now() + 19, title: '氏名変更・マイナンバー連携', empName: baseName, source: 'ライフイベント申請', deadline: safeDate, status: 'todo', agency: '社内労務' });
                }
                const dep = fetchedEventData.dependent || {};
                tasks.push({ 
                    id: Date.now() + 20, 
                    title: `【役所提出】健康保険 被扶養者異動届（取得）`, 
                    empName: baseName, 
                    source: "ライフイベント申請", 
                    dependentName: `${dep.lastNameKanji || ''} ${dep.firstNameKanji || ''}`.trim(), 
                    relation: dep.relation || '', 
                    birthDate: dep.birthDate || '', 
                    income: dep.income || '', 
                    living: dep.livingStatus || '', 
                    deadline: safeDate, 
                    status: 'todo', 
                    agency: '年金事務所' 
                });
            }
            // 👋 扶養喪失（外す）
            else if (target.event === 'remove_family') {
                tasks.push({ 
                    id: Date.now() + 21, 
                    title: `【役所提出】健康保険 被扶養者異動届（喪失）`, 
                    empName: baseName, 
                    source: 'ライフイベント申請', 
                    targetFamilyName: fetchedEventData.targetFamilyName || '', 
                    removeReason: fetchedEventData.removeReason || '', 
                    deadline: fetchedEventData.eventDate || safeDate, 
                    status: 'todo', 
                    agency: '年金事務所' 
                });
            }

// ... (他の else if が続く) ...

            // 🚪 退社手続き（資格喪失）
            // 🌟 修正：画面から来る"other"ではなく、Firebaseに保存した"resignation"で正確に判定する
            else if (fetchedEventData.event === 'resignation') {
            const resignInfo = fetchedEventData.dependent || {}; 
            const resignDate = resignInfo.resignDate || safeDate; // 退職予定日
            const needSlip = resignInfo.unemploymentSlip === '必要';

            // 1. 【必須】健康保険・厚生年金保険 被保険者資格喪失届
            tasks.push({
                id: Date.now() + 30, // 順番が被らないようにIDを設定
                title: '【役所提出】健康保険・厚生年金保険 被保険者資格喪失届',
                empName: baseName,
                source: 'ライフイベント申請',
                deadline: resignDate, // 期限の目安は退職日
                status: 'todo',
                agency: '年金事務所',
                memo: `【退職日】${resignDate}\n【保険証返却】${resignInfo.insuranceReturn || '不明'}`
            });

            // 2. 【必須】雇用保険 被保険者資格喪失届
            tasks.push({
                id: Date.now() + 31,
                title: '【役所提出】雇用保険 被保険者資格喪失届',
                empName: baseName,
                source: 'ライフイベント申請',
                deadline: resignDate,
                status: 'todo',
                agency: 'ハローワーク',
                memo: `【退職日】${resignDate}\n【離職票の発行】${resignInfo.unemploymentSlip || '不要'}`
            });

            // 3. 【条件付き】雇用保険 被保険者離職証明書（離職票が必要な場合のみ生成）
            if (needSlip) {
                tasks.push({
                    id: Date.now() + 32,
                    title: '【役所提出】雇用保険 被保険者離職証明書（離職票発行用）',
                    empName: baseName,
                    source: 'ライフイベント申請',
                    deadline: resignDate,
                    status: 'todo',
                    agency: 'ハローワーク',
                    memo: `【退職日】${resignDate}\n※本人が離職票の発行を希望しています。`
                });
            }
        }

        } else {
            console.warn(`ドキュメント ${docId} は存在しません`);
            continue;
        }
        } // 🌟 forループ終了

// 3. ループ終了後、まとめて保存・通知
localStorage.setItem('hr_tasks', JSON.stringify(tasks));
alert(`${targets.length} 件の承認とタスク生成が完了しました！`);
window.location.reload(); 

} catch (err) { // ★try終了、catch開始
console.error("承認エラー:", err);
alert('処理中にエラーが発生しました。');
} // ★catch終了
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
          const tasks = JSON.parse(localStorage.getItem('hr_tasks') || '[]');
          
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

          localStorage.setItem('hr_tasks', JSON.stringify(tasks));
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
  const usersSnap = await getDocs(collection(db, 'users'));
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