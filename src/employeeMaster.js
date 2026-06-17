import { collection, getDocs, doc, updateDoc, setDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './config/firebase.js'; // パスは環境に合わせてください
export async function initEmployeeMasterUI() {
    const tableBody = document.getElementById('employee-table-body');
    const searchInput = document.getElementById('search-emp');
    // 🌟 追加：タブ要素の取得
    const tabActive = document.getElementById('btn-filter-active');
    const tabRetired = document.getElementById('btn-filter-retired');
    // 👇＝＝＝ これを1行追加 ＝＝＝👇
    const typeFilterSelect = document.getElementById('emp-list-type-filter');
    let currentFilter = 'active'; // 初期表示は「在籍中」
    if (!tableBody)
        return;
    const modal = document.getElementById('employee-detail-modal');
    const closeModalBtn = document.getElementById('btn-close-detail');
    if (modal && closeModalBtn) {
        closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal)
                modal.classList.add('hidden');
        });
    }
    // 🌟 追加①：関数の外（ファイルの上の方など）で、カメラの電源スイッチを用意
    let unsubscribeEmployees = null;
    // Firebaseから社員を取得してリスト化するロジック（現役・退職を動的に切り替え）
    // Firebaseから社員を取得してリスト化するロジック
    const loadEmployees = () => {
        // 🌟 追加②：自分の「会社ID」を取得する！
        const currentCompanyId = localStorage.getItem('current_company_id');
        if (!currentCompanyId) {
            console.error("会社IDが見つかりません");
            return;
        }
        // 🌟 追加③：魔法のフィルター！「自分の会社の従業員」だけを狙い撃ち！
        const usersQuery = query(collection(db, "users"), where("companyId", "==", currentCompanyId));
        try {
            // 🌟 追加④：すでに監視カメラが動いていたら、一度停止（分身防止！）
            if (unsubscribeEmployees) {
                unsubscribeEmployees();
            }
            // 🌟 変更⑤：`collection(db, "users")` ではなく `usersQuery` を監視する！
            unsubscribeEmployees = onSnapshot(usersQuery, (usersSnap) => {
                tableBody.innerHTML = ''; // テーブル初期化
                // 🛑 ステップ：Firestoreのデータを一旦「配列」にすべて詰め込む！
                let allEmployees = [];
                usersSnap.forEach((uSnap) => {
                    const emp = uSnap.data();
                    emp.docId = uSnap.id; // ドキュメントIDもデータの中に入れておく
                    allEmployees.push(emp);
                });
                // 🌟 追加：現在のプルダウンの値を取得
                const selectedType = typeFilterSelect?.value || 'all';
                // 🌟 ステップ2-1：タブ（現役/退職）の条件で絞り込む
                let filteredEmployees = allEmployees.filter(emp => {
                    if (currentFilter === 'active' && emp.employeeStatus !== 'active')
                        return false;
                    if (currentFilter === 'retired' && emp.employeeStatus !== 'retired')
                        return false;
                    // 👇＝＝＝ 2. 区分フィルター（ここを追加！） ＝＝＝👇
                    if (selectedType !== 'all') {
                        const socInsType = emp.socialInsuranceType || 'regular'; // 未設定は一般扱い
                        if (socInsType !== selectedType)
                            return false;
                    }
                    // ☝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝☝
                    return true;
                });
                // 🌟 ステップ2-2：【最重要】社員番号順（昇順）に並び替える！
                filteredEmployees.sort((a, b) => {
                    // ⚠️ 注意: 'empId' の部分は、実際のFirestoreの「社員番号」のフィールド名に書き換えてください！
                    // （例：employeeId, empNumber など）
                    const idA = a.employeeId || "";
                    const idB = b.employeeId || "";
                    if (idA < idB)
                        return -1;
                    if (idA > idB)
                        return 1;
                    return 0;
                });
                let hasUser = filteredEmployees.length > 0;
                // 🌟 ステップ3：整列済みの配列を使って画面（tr）を作っていく
                filteredEmployees.forEach((emp) => {
                    const role = Number(emp.allowances?.role || 0);
                    const family = Number(emp.allowances?.family || 0);
                    const housing = Number(emp.allowances?.housing || 0);
                    const fixedOt = Number(emp.allowances?.fixedOt || 0);
                    const commute = Number(emp.allowances?.commute || 0);
                    const totalAllowances = role + family + housing + fixedOt + commute;
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid #dee2e6';
                    tr.style.cursor = 'pointer';
                    tr.classList.add('selectable');
                    // docIdを使って検索用キーワードを設定
                    tr.setAttribute('data-keyword', `${emp.lastNameKanji}${emp.firstNameKanji}${emp.lastNameKana}${emp.firstNameKana}${emp.docId}`.toLowerCase());
                    // ⬇️ 以下、既存の「const td = document.createElement('td');...」の処理が続きます！
                    // 🌟 追加：退職済タブの場合は「取消ボタン」の代わりに「退職ラベル」を表示
                    const actionHtml = currentFilter === 'active'
                        ? `<button class="btn-cancel-emp" data-id="${emp.docId}" data-email="${emp.email || emp.docId}" style="padding: 4px 8px; background: #fff; color: #dc3545; border: 1px solid #dc3545; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold; transition: 0.2s;">❌ 雇用形態変更</button>`
                        : `<span style="background: #e0e0e0; color: #555; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">退職済</span>`;
                    tr.innerHTML = `
        <td style="padding: 12px 10px; font-weight: bold; color: #555;">${emp.employeeId || '<span style="color: #999;">未採番</span>'}</td>
        <td style="padding: 12px 10px;">
          <strong style="color:#111; font-size:14px;">${emp.lastNameKanji || ""} ${emp.firstNameKanji || ""}</strong><br>
          <span style="font-size:11px; color:#888;">${emp.lastNameKana || ""} ${emp.firstNameKana || ""}</span>
        </td>
        <td style="padding: 12px 10px; color: #0056b3;">${emp.email || '<span style="color: #999;">未登録</span>'}</td>
        <td style="padding: 12px 10px;"><span style="background: #e3f2fd; color: #0056b3; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">
        ${emp.contractInfo?.empType || '正社員'}</span></td>
        <td style="padding: 12px 10px;">📅 ${emp.contractInfo?.startDate || '未定'}</td>
        <td style="padding: 12px 10px; font-weight: bold; color: #2e7d32;">¥${(Number(emp.baseHealth) || 0).toLocaleString()}</td>
        <td style="padding: 12px 10px; color: #666;">¥${totalAllowances.toLocaleString()}</td>
        <td style="padding: 12px 10px;">⏱️ ${emp.workingHours?.weekly || 0}h</td>
        <td style="padding: 12px 10px; text-align: center;">${actionHtml}</td>
      `;
                    tr.addEventListener('click', (e) => {
                        if (e.target.closest('.btn-cancel-emp'))
                            return;
                        const detailContent = document.getElementById('employee-detail-content');
                        if (modal && detailContent) {
                            // =========================================================
                            // 🌟🌟🌟 追加：給与形態に応じた「基本給」の動的HTML生成 🌟🌟🌟
                            // =========================================================
                            const salaryType = emp.salaryType || '月給'; // '月給', '日給', '時給'
                            const baseAmt = Number(emp.baseSalary || emp.baseHealth || 0); // 単価
                            const weeklyHours = Number(emp.workingHours?.weekly || 0); // 週の労働時間
                            let baseSalaryHtml = '';
                            if (salaryType === '時給') {
                                // 時給の場合は、以前作っていただいた「月額目安」の計算式を適用！
                                const estimatedMonthly = Math.round(baseAmt * weeklyHours * 52 / 12);
                                baseSalaryHtml = `<p style="margin: 6px 0; font-size: 14px;"><strong>基本給 (時給):</strong> ${baseAmt.toLocaleString()} 円 <span style="color:#0056b3; font-size: 12px; font-weight: bold;">(≒ 月額目安: ${estimatedMonthly.toLocaleString()} 円)</span></p>`;
                            }
                            else if (salaryType === '日給') {
                                baseSalaryHtml = `<p style="margin: 6px 0; font-size: 14px;"><strong>基本給 (日給):</strong> ${baseAmt.toLocaleString()} 円 <span style="color:#666; font-size: 12px;">(※出勤日数に応じて支給)</span></p>`;
                            }
                            else {
                                baseSalaryHtml = `<p style="margin: 6px 0; font-size: 14px;"><strong>基本給 (月給):</strong> ${baseAmt.toLocaleString()} 円</p>`;
                            }
                            // =========================================================
                            // =========================================================
                            // 🌟 追加①：社会保険料「免除」バッジの生成
                            // =========================================================
                            const exemptBadgeHtml = emp.isSocialInsuranceExempt
                                ? `<span style="background: #dc3545; color: white; font-size: 12px; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle;">🆓 社会保険料免除中</span>`
                                : '';
                            // =========================================================
                            // 🌟 追加②：扶養家族のループ描画ロジック（複数人対応！）
                            // =========================================================
                            let dependentsHtml = '';
                            // 新仕様（配列）があればそれを使い、なければ空配列
                            const depList = Array.isArray(emp.dependents) ? emp.dependents : [];
                            // 💡 後方互換性：昔の単一データ(emp.dependent)しか持っていない社員への配慮
                            if (depList.length === 0 && emp.hasDependent && emp.dependent) {
                                depList.push(emp.dependent);
                            }
                            if (depList.length > 0) {
                                // 家族の人数分だけHTMLのブロックをループして作成し、最後に繋げる
                                dependentsHtml = depList.map((dep, index) => {
                                    // 🔴 喪失判定とスタイルの設定
                                    const isRemoved = dep.isRemoved === true;
                                    const badgeHtml = isRemoved ? `<span style="background: #dc3545; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 8px; font-weight: bold;">喪失済</span>` : '';
                                    const rowStyle = isRemoved ? 'opacity: 0.65; background-color: #f8f9fa; border-left: 4px solid #dc3545; padding-left: 10px;' : '';
                                    const borderStyle = index !== depList.length - 1 ? 'border-bottom: 1px dashed #ccc; padding-bottom: 12px; margin-bottom: 12px;' : '';
                                    const removedDateHtml = isRemoved && dep.removedDate ? `<p style="margin: 6px 0; font-size: 12px; color: #dc3545;"><strong>システム喪失日:</strong> ${new Date(dep.removedDate).toLocaleDateString()}</p>` : '';
                                    return `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; transition: all 0.3s; ${borderStyle} ${rowStyle}">
                  <div>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>氏名:</strong> ${dep.lastNameKanji || ''} ${dep.firstNameKanji || ''} <span style="color:#666; font-size: 12px;">(${dep.lastNameKana || ''} ${dep.firstNameKana || ''})</span> ${badgeHtml}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>続柄:</strong> ${dep.relation || dep.relationship || '未設定'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>生年月日:</strong> ${dep.birthDate || dep.birthdate || '未設定'}</p>
                  </div>
                  <div>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>同居 / 別居:</strong> ${dep.livingStatus || '未設定'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>年間収入見込:</strong> ${dep.income || dep.estimatedIncome ? Number(dep.income || dep.estimatedIncome).toLocaleString() + ' 円' : '0 円'}</p>
                    ${dep.hasDisability ? `<p style="margin: 6px 0; font-size: 14px; color: #dc3545;"><strong>障害の有無:</strong> あり</p>` : ''}
                    ${removedDateHtml}
                  </div>
                </div>
              `;
                                }).join('');
                            }
                            else {
                                dependentsHtml = `<p style="margin: 6px 0; font-size: 14px; color: #666;">扶養する家族はいません（または未登録）</p>`;
                            }
                            // =========================================================
                            // 🌟 最終描画：組み立てたHTMLを流し込む！
                            // =========================================================
                            detailContent.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                  <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <h4 style="color: #0056b3; margin-top: 0; border-bottom: 2px solid #e3f2fd; padding-bottom: 8px;">👤 本人基本情報</h4>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>社員番号:</strong> ${emp.employeeId || '未設定'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>氏名:</strong> ${emp.lastNameKanji || ''} ${emp.firstNameKanji || ''} <span style="color:#666; font-size: 12px;">(${emp.lastNameKana || ''} ${emp.firstNameKana || ''})</span>${exemptBadgeHtml}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>生年月日:</strong> ${emp.birthdate || '未設定'} / <strong>性別:</strong> ${emp.gender === 'male' ? '男性' : emp.gender === 'female' ? '女性' : '未設定'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>現住所:</strong> ${emp.currentAddress || '未設定'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>住民票:</strong> ${emp.registeredAddress || '未設定'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>通勤経路:</strong> ${emp.commuteRoute || '未入力'}</p>
                  </div>
  
                  <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <h4 style="color: #28a745; margin-top: 0; border-bottom: 2px solid #e8f5e9; padding-bottom: 8px;">🏢 契約・給与情報</h4>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>雇用形態:</strong> ${emp.contractInfo?.empType || '正社員'}</p>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>入社日:</strong> ${emp.contractInfo?.startDate || '未定'}</p>
                    ${baseSalaryHtml} <p style="margin: 6px 0; font-size: 14px; font-weight: bold; color: #d32f2f;"><strong>手当合計:</strong> ${totalAllowances.toLocaleString()} 円</p>
                    <ul style="margin: 4px 0 12px; padding-left: 20px; font-size: 12px; color: #555;">
                      <li>役職手当: ${role.toLocaleString()} 円</li>
                      <li>家族手当: ${family.toLocaleString()} 円</li>
                      <li>住宅手当: ${housing.toLocaleString()} 円</li>
                      <li>固定残業代: ${fixedOt.toLocaleString()} 円</li>
                      <li>通勤交通費: ${commute.toLocaleString()} 円</li>
                    </ul>
                    <p style="margin: 6px 0; font-size: 14px;"><strong>週所定労働時間:</strong> ${emp.workingHours?.weekly || 0} h</p>
                  </div>
  
                  <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #ddd; grid-column: span 2; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <h4 style="color: #6f42c1; margin-top: 0; border-bottom: 2px solid #f3e5f5; padding-bottom: 8px;">🏦 公的番号・口座情報</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                      <div>
                        <p style="margin: 6px 0; font-size: 14px;"><strong>マイナンバー:</strong> ${emp.myNumber ? '登録済み' : '未登録'}</p>
                        <p style="margin: 6px 0; font-size: 14px;"><strong>年金番号:</strong> ${emp.pensionNumber || '未登録'}</p>
                        <p style="margin: 6px 0; font-size: 14px;"><strong>雇用保険番号:</strong> ${emp.employmentInsuranceNumber || '未登録'}</p>
                      </div>
                      <div>
                        <p style="margin: 6px 0; font-size: 14px;"><strong>給与振込口座:</strong> ${emp.bankInfo?.bankName || '未登録'} ${emp.bankInfo?.branchName || ''}</p>
                        <p style="margin: 6px 0; font-size: 14px;"><strong>口座情報:</strong> ${emp.bankInfo?.accountType || ''} ${emp.bankInfo?.accountNumber || ''}</p>
                      </div>
                    </div>
                  </div>
  
                  <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #ddd; grid-column: span 2; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <h4 style="color: #fd7e14; margin-top: 0; border-bottom: 2px solid #fff3cd; padding-bottom: 8px;">👨‍👩‍👧 扶養家族情報</h4>
                    ${dependentsHtml}
                  </div>
                </div>
              `;
                            modal.classList.remove('hidden');
                        }
                    });
                    tableBody.appendChild(tr);
                });
                // ▼ 取消ボタンの処理
                tableBody.querySelectorAll('.btn-cancel-emp').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const target = e.currentTarget;
                        const userId = target.getAttribute('data-id');
                        const userEmail = target.getAttribute('data-email');
                        if (!userId || !userEmail)
                            return;
                        if (!confirm(`⚠️ この従業員の登録を取り消しますか？\n\n【実行される処理】\n・この一覧（現役マスタ）からデータが削除されます。\n・入社手続きのステータスが「確認待ち」に戻り、再編集が可能になります。`))
                            return;
                        try {
                            target.innerText = '⏳ 取消中...';
                            target.disabled = true;
                            // 🌟 念のため、実行者がちゃんとログインしているか防壁チェック
                            const currentCompanyId = localStorage.getItem('current_company_id');
                            if (!currentCompanyId)
                                throw new Error("会社IDがありません");
                            // 🌟 setDoc({merge:true}) から、より安全な updateDoc へアップグレード！
                            // （万が一データが存在しない時は、勝手に作らずにちゃんとエラーにしてくれる）
                            await updateDoc(doc(db, 'users', userId), {
                                employeeStatus: 'pending',
                                updatedAt: new Date() // 💡 いつ取り消されたかの履歴も残しておくと完璧です
                            });
                            await updateDoc(doc(db, 'invites', userEmail), {
                                status: '確認待ち',
                                updatedAt: new Date()
                            });
                            alert('↩️ 登録を取り消し、入社手続き（確認待ち）へ戻しました。');
                            loadEmployees(); // リロードの代わりにリストを再描画
                        }
                        catch (err) {
                            console.error("登録取消エラー:", err);
                            alert("取り消し処理に失敗しました。対象のデータが見つからない可能性があります。");
                            target.innerText = '❌ 取消';
                            target.disabled = false;
                        }
                    });
                });
                if (!hasUser) {
                    const msg = currentFilter === 'active'
                        ? '📋 現在、正式登録されている従業員はいません。'
                        : '📋 現在、退職済の従業員はいません。';
                    tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:#999; font-style:italic;">${msg}</td></tr>`;
                }
            });
        }
        catch (error) {
            console.error("従業員マスタ取得エラー:", error);
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#dc3545; font-weight:bold;">⚠️ データの読み込みに失敗しました。</td></tr>`;
        }
    };
    // 🌟 追加：タブのクリックイベント（見た目の切り替えとデータの再取得）
    if (tabActive && tabRetired) {
        tabActive.addEventListener('click', () => {
            currentFilter = 'active';
            tabActive.style.background = '#0056b3';
            tabActive.style.color = 'white';
            tabRetired.style.background = '#e0e0e0';
            tabRetired.style.color = '#555';
            loadEmployees();
        });
        tabRetired.addEventListener('click', () => {
            currentFilter = 'retired';
            tabRetired.style.background = '#0056b3';
            tabRetired.style.color = 'white';
            tabActive.style.background = '#e0e0e0';
            tabActive.style.color = '#555';
            loadEmployees();
        });
    }
    // 👇＝＝＝ これを追加 ＝＝＝👇
    // 🌟 区分プルダウンが切り替わったら再読み込み
    typeFilterSelect?.addEventListener('change', () => {
        loadEmployees();
    });
    // ☝＝＝＝＝＝＝＝＝＝＝＝＝☝
    // 検索窓のリアルタイム絞り込み機能
    searchInput?.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const keyword = row.getAttribute('data-keyword');
            if (!keyword)
                return;
            row.style.display = keyword.includes(query) ? '' : 'none';
        });
    });
    // 実行
    loadEmployees();
}
//# sourceMappingURL=employeeMaster.js.map