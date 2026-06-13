// 公開用json作成.gs のバックアップ
// 最終更新: 2026-06-13
// GASエディタから全文コピペして、この下に貼り付ける

/**
 * 公開用Tier全パターン一括計算
 * 720条件（縛り8 × コスト帯5 × 枠6 × 補正3）を1パスで集計しJSON出力。
 * モード（使用者数/ランクアップ）・最小データ数(5/10/20)はフロント適用。
 */
function generateAllPublicTiers() {
  const T = {};
  const t_ = l => { T[l] = Date.now(); };
  const te_ = l => { T[l] = Date.now() - T[l]; };

  t_('全体');
  const ssId = SpreadsheetApp.getActiveSpreadsheet().getId();

  // ① 一括読込（通信1回）
  t_('①読込');
  const vr = Sheets.Spreadsheets.Values.batchGet(ssId, {
    ranges: [
      "'縛りマスター'!A2:B",
      "'キャラマスター'!A2:B",
      "'勝敗マスター'!A2:D",
      "'試合縛りID'!A2:F",
      "'チーム結果ID'!A2:C",
      "'デッキ情報ID'!A2:E",
      "'デッキキャラID'!A2:C",
      "'補正ID'!A2:B"
    ]
  }).valueRanges.map(r => r.values || []);
  const pad_ = (row, n) => { while (row.length < n) row.push(''); return row; };
  te_('①読込');

  // ② マスター解析
  t_('②解析');
  const shibariMaster = {};
  vr[0].forEach(r => { const row = pad_(r, 2); shibariMaster[String(row[0])] = String(row[1]); });

  const charMaster = {};
  vr[1].forEach(r => { const row = pad_(r, 2); if (row[1]) charMaster[String(row[0])] = String(row[1]); });

  // 勝敗ID → ランクアップ数
  const rankUpMap = new Map();
  vr[2].forEach(r => { const row = pad_(r, 4); rankUpMap.set(String(row[0]), Number(row[3])); });

  // 試合ID → {sb: 縛りID, cb: コスト帯, ev: イベントID}
  const matchInfo = new Map();
  vr[3].forEach(r => {
    const row = pad_(r, 6);
    matchInfo.set(String(row[0]), { sb: String(row[4]), cb: costBandName_(row[5]), ev: String(row[1]) });
  });

  // 試合ID_陣営ID → 勝敗ID
  const teamResult = new Map();
  vr[4].forEach(r => { const row = pad_(r, 3); teamResult.set(row[0] + '_' + row[1], String(row[2])); });

  // デッキID → {mid: 試合ID, ji: 陣営ID}
  const deckMap = new Map();
  vr[5].forEach(r => { const row = pad_(r, 5); deckMap.set(String(row[0]), { mid: String(row[1]), ji: String(row[2]) }); });

  // 補正セット: イベントID_キャラID
  const hoseiSet = new Set();
  vr[7].forEach(r => { const row = pad_(r, 2); hoseiSet.add(row[0] + '_' + row[1]); });
  te_('②解析');

  // ③ デッキキャラ1パス → 全バケット同時集計
  //    キー: 縛りID|コスト帯|枠|補正  (*=全)
  //    値: { キャラID: [使用者数, ランクアップ合計] }
  t_('③集計');
  const stats = {};

  vr[6].forEach(r => {
    const row = pad_(r, 3);
    const dk = deckMap.get(String(row[0]));
    if (!dk) return;
    const mt = matchInfo.get(dk.mid);
    if (!mt) return;
    const cId = String(row[2]);
    if (!cId) return;

    const wlId = teamResult.get(dk.mid + '_' + dk.ji);
    const rankUp = rankUpMap.get(String(wlId)) || 0;
    const waku = String(Number(row[1]));
    const hosei = hoseiSet.has(mt.ev + '_' + cId) ? '1' : '0';

    // 各行は最大16バケットに所属（縛り2 × コスト帯2 × 枠2 × 補正2）
    for (const sk of ['*', mt.sb]) {
      for (const ck of ['*', mt.cb]) {
        for (const wk of ['*', waku]) {
          for (const hk of ['*', hosei]) {
            const key = sk + '|' + ck + '|' + wk + '|' + hk;
            if (!stats[key]) stats[key] = {};
            if (!stats[key][cId]) stats[key][cId] = [0, 0];
            stats[key][cId][0]++;
            stats[key][cId][1] += rankUp;
          }
        }
      }
    }
  });
  te_('③集計');

  // ④ JSON出力 → Google Drive
  t_('④出力');
  const output = {
    generated: new Date().toISOString(),
    meta: {
      shibari: shibariMaster,
      chars: charMaster,
      costBands: ['低', '中', '高', '超高'],
      keyFormat: '縛りID|コスト帯|枠|補正 (*=全)',
      valFormat: '{キャラID: [使用者数, ランクアップ合計]}'
    },
    data: stats
  };
  const json = JSON.stringify(output);
  DriveApp.createFile('tier_all_patterns.json', json, MimeType.PLAIN_TEXT);
  te_('④出力');

  te_('全体');
  const cnt = Object.keys(stats).length;
  const timing = Object.entries(T).map(([k, v]) => k + ': ' + v + 'ms').join('\n');
  Browser.msgBox('完了\nパターン数: ' + cnt + '\nJSON: ' + (json.length / 1024).toFixed(0) + 'KB\n\n' + timing);
}