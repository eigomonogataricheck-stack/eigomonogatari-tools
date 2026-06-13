// Code.gs のバックアップ
// 最終更新: 2026-06-13
// GASエディタから全文コピペして、この下に貼り付ける

/**
 * new_code_v2.gs
 * 新スプレッドシート用 Code.gs
 * 方針:
 * - 「試合縛り入力」などは人間編集用のテキスト原本
 * - 「試合縛りID」などは集計用のID化シート
 * - 集計前に rebuildIdSheets() を実行して、原本全体をID化する
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('英語物語')
    .addItem('シート構成セットアップ', 'setupSheets')
    .addItem('転記（入力→原本シート）', 'integratedTransferProcess')
    .addItem('陣営を0/1へ変換（一度だけ）', 'normalizeJineiToIdOnce')
    .addItem('IDシート再生成', 'rebuildIdSheets')
    .addItem('Tier集計', 'generateTierAdvanced')
    .addItem('公開用全パターン計算', 'generateAllPublicTiers')
    .addItem('入力シート白紙化', 'clearInputData')
    .addItem('画像解析データ整形', 'formatEigomon')
    .addToUi();
  updateCharaListPulldown();
}

function normalizeJineiToIdOnce() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const normalizeRange = (sheetName, col) => {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;

    const range = sh.getRange(2, col, sh.getLastRow() - 1, 1);
    const values = range.getValues().map(r => {
      if (r[0] === 'A') return [0];
      if (r[0] === 'B') return [1];
      return [r[0]];
    });
    range.setValues(values);
  };

  normalizeRange('チーム結果入力', 2);
  normalizeRange('デッキ情報入力', 3);

  rebuildIdSheetsCore_(ss);
  SpreadsheetApp.getUi().alert('陣営を 0=A / 1=B に変換しました。');
}

function rebuildIdSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  rebuildIdSheetsCore_(ss);
  updateCharaListPulldown();
  SpreadsheetApp.getUi().alert('IDシート再生成完了');
}

function rebuildIdSheetsCore_(ss) {
  const log = [];

  const readBody_ = (name) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  };

  const makeNameToId_ = (sheetName, idCol, nameCol) => {
    const rows = readBody_(sheetName);
    const map = new Map();
    rows.forEach(r => {
      if (r[nameCol] !== '' && r[nameCol] != null) map.set(String(r[nameCol]), r[idCol]);
    });
    return map;
  };

  const charaMap = makeNameToId_('キャラマスター', 0, 1);
  const shibariMap = makeNameToId_('縛りマスター', 0, 1);
  const countryMap = makeNameToId_('開催国マスター', 0, 1);
  const winlossMap = makeNameToId_('勝敗マスター', 0, 1);
  const rankMap = makeNameToId_('ランクマスター', 0, 1);

  const conv_ = (map, val, where) => {
    if (val === '' || val == null) return '';
    const key = String(val);
    if (map.has(key)) return map.get(key);
    log.push(where + ': 未変換「' + key + '」');
    return '';
  };

  const write_ = (name, data) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.clear();
    if (data.length && data[0].length) sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  };

  const match = readBody_('試合縛り入力').map((r, i) => [
    r[0], r[1], r[2],
    conv_(countryMap, r[3], '試合縛り入力 行' + (i + 2) + ' 開催国'),
    conv_(shibariMap, r[4], '試合縛り入力 行' + (i + 2) + ' 縛り'),
    r[5]
  ]);
  write_('試合縛りID', [['試合ID','イベントID','試合日','開催国ID','縛りID','コスト'], ...match]);

  const team = readBody_('チーム結果入力').map((r, i) => [
    r[0],
    r[1],
    conv_(winlossMap, r[2], 'チーム結果入力 行' + (i + 2) + ' 勝敗')
  ]);
  write_('チーム結果ID', [['試合ID','陣営ID','勝敗ID'], ...team]);

  const deckInfo = readBody_('デッキ情報入力').map((r, i) => [
    r[0], r[1],
    r[2],
    conv_(rankMap, r[3], 'デッキ情報入力 行' + (i + 2) + ' ランク'),
    r[4]
  ]);
  write_('デッキ情報ID', [['デッキID','試合ID','陣営ID','ランクID','レート'], ...deckInfo]);

  const deckChar = readBody_('デッキキャラ入力').map((r, i) => [
    r[0], r[1], conv_(charaMap, r[2], 'デッキキャラ入力 行' + (i + 2) + ' キャラ')
  ]);
  write_('デッキキャラID', [['デッキID','枠','キャラID'], ...deckChar]);

  const hosei = readBody_('補正入力').map((r, i) => [
    r[0], conv_(charaMap, r[1], '補正入力 行' + (i + 2) + ' キャラ')
  ]);
  write_('補正ID', [['イベントID','キャラID'], ...hosei]);

  write_('変換ログ', log.length ? [['内容'], ...log.map(x => [x])] : [['内容'], ['未変換なし']]);
}

function integratedTransferProcess() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName('入力');
  const teamResultSheet = ss.getSheetByName('チーム結果入力');
  const deckInfoSheet = ss.getSheetByName('デッキ情報入力');
  const deckCharSheet = ss.getSheetByName('デッキキャラ入力');

  if (!inputSheet || !teamResultSheet || !deckInfoSheet || !deckCharSheet) {
    Browser.msgBox('エラー: 必要なシートが見つかりません。');
    return;
  }

  const at = inputSheet.getRange('D16').getValue();
  if (isNaN(at) || at === '') {
    Browser.msgBox('エラー: 入力シートのD16（＠）が数値ではありません。');
    return;
  }

  teamResultSheet.getRange(at * 2, 3).setValue(inputSheet.getRange('B16').getValue());
  teamResultSheet.getRange(at * 2 + 1, 3).setValue(inputSheet.getRange('B17').getValue());

  const deckInfoStartRow = at * 10 - 8;
  const ranges = inputSheet.getRangeList(['J2:J6', 'J8:J12', 'I2:I6', 'I8:I12']).getRanges();
  const j2j6 = ranges[0].getValues();
  const j8j12 = ranges[1].getValues();
  const i2i6 = ranges[2].getValues();
  const i8i12 = ranges[3].getValues();

  const infoValues = new Array(10).fill(null).map(() => ['', '']);
  for (let i = 0; i < 5; i++) {
    infoValues[i][0] = j2j6[i][0];
    infoValues[i][1] = j8j12[i][0];
    infoValues[i + 5][0] = i2i6[i][0];
    infoValues[i + 5][1] = i8i12[i][0];
  }
  deckInfoSheet.getRange(deckInfoStartRow, 4, 10, 2).setValues(infoValues);

  const deckCharStartRow = at * 50 - 48;
  const rowIndices = [2, 9, 3, 10, 4, 11, 5, 12, 6, 13];
  const allData = inputSheet.getRange(1, 2, 13, 5).getValues();
  const charValues = [];
  rowIndices.forEach(idx => {
    allData[idx - 1].forEach(val => charValues.push([val]));
  });
  deckCharSheet.getRange(deckCharStartRow, 3, 50, 1).setValues(charValues);

  rebuildIdSheetsCore_(ss);
  updateCharaListPulldown();
  Browser.msgBox('転記完了。原本シート更新後、IDシートも再生成しました。');
}

function updateCharaListPulldown() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dc = ss.getSheetByName('デッキキャラID');
  const cm = ss.getSheetByName('キャラマスター');
  const cond = ss.getSheetByName('tier条件入力');
  const list = ss.getSheetByName('対戦数キャラリスト');
  if (!dc || !cm || !cond || !list || dc.getLastRow() < 2 || cm.getLastRow() < 2) return;

  const idToName = new Map();
  cm.getRange(2, 1, cm.getLastRow() - 1, 2).getValues().forEach(r => idToName.set(String(r[0]), String(r[1])));

  const counts = {};
  dc.getRange(2, 3, dc.getLastRow() - 1, 1).getValues().forEach(r => {
    const id = String(r[0]);
    if (!id) return;
    const name = idToName.get(id) || id;
    counts[name] = (counts[name] || 0) + 1;
  });

  const rows = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(x => [x]);
  list.clearContents();
  if (rows.length) {
    list.getRange(1, 1, rows.length, 1).setValues(rows);
    const rule = SpreadsheetApp.newDataValidation().requireValueInRange(list.getRange(1,1,rows.length,1)).setAllowInvalid(false).build();
    cond.getRange('B14').setDataValidation(rule);
  }
}

function generateTierAdvanced() {
  const T = {};
  const t_ = (label) => { T[label] = Date.now(); };
  const te_ = (label) => { T[label] = Date.now() - T[label]; };

  t_('全体');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();

  // --- 1. 全シート一括読み込み (Sheets API batchGet: 通信1回) ---
  t_('①一括読込');
  const batchRes = Sheets.Spreadsheets.Values.batchGet(ssId, {
    ranges: [
      "'tier条件入力'!B1:B14",
      "'縛りマスター'!A2:B",
      "'開催国マスター'!A2:B",
      "'ランクマスター'!A2:B",
      "'キャラマスター'!A2:B",
      "'勝敗マスター'!A2:D",
      "'試合縛りID'!A2:F",
      "'チーム結果ID'!A2:C",
      "'デッキ情報ID'!A2:E",
      "'デッキキャラID'!A2:C",
      "'補正ID'!A2:B"
    ]
  });
  const vr = batchRes.valueRanges.map(r => r.values || []);
  const pad_ = (row, n) => { while (row.length < n) row.push(''); return row; };
  te_('①一括読込');

  // --- 2. 条件+マスター解析 ---
  t_('②条件+マスター解析');
  const condArr = vr[0].map(r => (r && r[0] !== undefined) ? r[0] : '');
  while (condArr.length < 14) condArr.push('');

  const mode = String(condArr[0]);
  const targetName = String(condArr[13]);
  const minCount = Number(condArr[12]) || 0;

  const findId_ = (data, name) => {
    if (!name) return null;
    const found = data.find(r => String(pad_(r, 2)[1]) === String(name));
    return found ? found[0] : null;
  };

  const condShibariId = findId_(vr[1], condArr[1]);
  const condCostBand = condArr[2] === '' ? null : String(condArr[2]);
  const condCountryId = findId_(vr[2], condArr[3]);
  const dateMin = condArr[4] || null;
  const dateMax = condArr[5] || null;
  const rankMinId = findId_(vr[3], condArr[6]);
  const rankMaxId = findId_(vr[3], condArr[7]);
  const rateMin = condArr[8] === '' ? null : Number(condArr[8]);
  const rateMax = condArr[9] === '' ? null : Number(condArr[9]);
  const waku = condArr[10] === '' ? null : Number(condArr[10]);
  const hoseiCond = condArr[11] === '' ? null : Number(condArr[11]);

  const idToName = new Map();
  const nameToId = new Map();
  vr[4].forEach(r => {
    const row = pad_(r, 2);
    if (row[1]) { idToName.set(String(row[0]), String(row[1])); nameToId.set(String(row[1]), row[0]); }
  });
  const targetId = nameToId.get(targetName) || null;

  const winInfo = new Map();
  vr[5].forEach(r => {
    const row = pad_(r, 4);
    winInfo.set(String(row[0]), { win: Number(row[2]), rankUp: Number(row[3]) });
  });
  te_('②条件+マスター解析');

  const check_ = (v, target, type) => {
    if (target === null || target === '') return true;
    if (v === '' || v == null) return false;
    if (type === 'eq') return String(v) === String(target);
    let nv = Number(v), nt = Number(target);
    if (isNaN(nv) || isNaN(nt)) {
      nv = new Date(v).getTime();
      nt = new Date(target).getTime();
      if (isNaN(nv) || isNaN(nt)) return true;
    }
    return type === 'min' ? nv >= nt : nv <= nt;
  };

  // --- 3. フィルタ+集計 ---
  t_('③フィルタ+集計');
  const validMatch = new Set();
  const matchToEvent = new Map();
  vr[6].forEach(r => {
    const row = pad_(r, 6);
    if (!check_(row[4], condShibariId, 'eq')) return;
    if (!check_(row[3], condCountryId, 'eq')) return;
    if (condCostBand !== null && costBandName_(row[5]) !== condCostBand) return;
    if (!check_(row[2], dateMin, 'min')) return;
    if (!check_(row[2], dateMax, 'max')) return;
    validMatch.add(String(row[0]));
    matchToEvent.set(String(row[0]), String(row[1]));
  });

  const teamResult = new Map();
  vr[7].forEach(r => {
    const row = pad_(r, 3);
    if (validMatch.has(String(row[0]))) teamResult.set(String(row[0]) + '_' + String(row[1]), String(row[2]));
  });

  const validDeck = new Set();
  const deckInfo = new Map();
  vr[8].forEach(r => {
    const row = pad_(r, 5);
    if (!validMatch.has(String(row[1]))) return;
    if (!check_(row[3], rankMinId, 'min')) return;
    if (!check_(row[3], rankMaxId, 'max')) return;
    if (!check_(row[4], rateMin, 'min')) return;
    if (!check_(row[4], rateMax, 'max')) return;
    validDeck.add(String(row[0]));
    deckInfo.set(String(row[0]), { matchId: String(row[1]), jineiId: String(row[2]) });
  });

  const validEvent = new Set(matchToEvent.values());
  const hoseiSet = new Set();
  vr[10].forEach(r => {
    const row = pad_(r, 2);
    if (validEvent.has(String(row[0]))) hoseiSet.add(String(row[0]) + '_' + String(row[1]));
  });

  const dcRows = vr[9].map(r => pad_(r, 3));
  let targetTeam = null;
  if ((mode === '相性' || mode === '対メタ') && targetId != null) {
    targetTeam = new Map();
    dcRows.forEach(r => {
      const dId = String(r[0]);
      if (!validDeck.has(dId)) return;
      if (String(r[2]) === String(targetId)) {
        const di = deckInfo.get(dId);
        if (di) targetTeam.set(di.matchId, di.jineiId);
      }
    });
  }

  const stats = {};
  dcRows.forEach(r => {
    const dId = String(r[0]);
    const cId = String(r[2]);
    if (!validDeck.has(dId) || !cId) return;
    if (waku !== null && Number(r[1]) !== waku) return;
    const di = deckInfo.get(dId);
    if (!di) return;

    if (hoseiCond !== null) {
      const eventId = matchToEvent.get(di.matchId);
      const isHosei = hoseiSet.has(eventId + '_' + cId) ? 1 : 0;
      if (isHosei !== hoseiCond) return;
    }

    if (targetTeam) {
      const t = targetTeam.get(di.matchId);
      if (t === undefined) return;
      if (mode === '相性' && di.jineiId !== t) return;
      if (mode === '対メタ' && di.jineiId === t) return;
    }

    const wlId = teamResult.get(di.matchId + '_' + di.jineiId);
    const wl = winInfo.get(String(wlId)) || { win: 0, rankUp: 0 };
    if (!stats[cId]) stats[cId] = { count: 0, sum: 0 };
    stats[cId].count++;
    if (mode === '勝率') stats[cId].sum += wl.win === 1 ? 1 : 0;
    else if (mode !== '使用者数') stats[cId].sum += wl.rankUp;
  });
  te_('③フィルタ+集計');

  let results = [];
  Object.keys(stats).forEach(cId => {
    const s = stats[cId];
    if (s.count < minCount) return;
    results.push([idToName.get(cId) || cId, s.count, s.sum, s.count ? s.sum / s.count : 0, cId]);
  });
  results.sort((a, b) => mode === '使用者数' ? b[1] - a[1] : b[3] - a[3]);

  // --- 4. 書込 (batchClear + batchUpdate: 通信2回) ---
  t_('④書込');

  Sheets.Spreadsheets.Values.batchClear(
    { ranges: ["'裏データ'!A2:D", "'tier'!B1:ZZ8"] },
    ssId
  );

  const writeData = [];

  if (results.length) {
    writeData.push({
      range: "'裏データ'!A2",
      values: results.map(r => [r[0], r[1], mode === '使用者数' ? '' : r[2], mode === '使用者数' ? '' : r[3]])
    });
  }

  const rows = [[], [], [], [], [], [], [], []];
  let th;
  if (mode === '使用者数') {
    const m = results.length ? results[0][1] : 0;
    th = [m / 2, m / 3, m / 4, m / 5, m / 6, m / 7, m / 8, 0];
  } else if (mode === '勝率') th = [0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.3, -Infinity];
  else th = [0.4, 0.25, 0.1, 0, -0.1, -0.25, -0.4, -Infinity];

  results.forEach(r => {
    const val = mode === '使用者数' ? r[1] : r[3];
    const img = '=IMAGE("https://englishstoryserver.com/Icon/Icon/Icon' + r[4] + '.png")';
    for (let i = 0; i < th.length; i++) if (val >= th[i]) { rows[i].push(img); break; }
  });

  const maxCols = Math.max(...rows.map(r => r.length), 0);
  if (maxCols) {
    writeData.push({
      range: "'tier'!B1",
      values: rows.map(r => { while (r.length < maxCols) r.push(''); return r; })
    });
  }

  if (writeData.length) {
    Sheets.Spreadsheets.Values.batchUpdate(
      { valueInputOption: 'USER_ENTERED', data: writeData },
      ssId
    );
  }

  te_('④書込');

  te_('全体');
  const timing = Object.entries(T).map(([k, v]) => k + ': ' + v + 'ms').join('\n');
  Browser.msgBox('集計完了\n該当試合: ' + validMatch.size + '\n該当デッキ: ' + validDeck.size + '\n結果キャラ数: ' + results.length + '\n\n--- 計測 ---\n' + timing);
}

function costBandName_(cost) {
  const v = Number(cost);
  if (v >= 351) return '超高';
  if (v >= 221) return '高';
  if (v >= 151) return '中';
  return '低';
}

function clearInputData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('入力');
  if (!sheet) return;
  sheet.getRangeList(['B2:F6','B9:F13','I2:J6','I8:J12','B16:B17','D16']).clearContent();
}

function fillDeckInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('デッキ情報入力');
  if (!sheet) return;

  const last = Math.max(sheet.getLastRow(), 10001);
  const out = [];

  for (let i = 0; i < last - 1; i++) {
    const matchId = Math.floor(i / 10) + 1;
    const pos = i % 10;
    const jineiId = pos < 5 ? 1 : 0;
    out.push([matchId, jineiId]);
  }

  sheet.getRange(2, 2, out.length, 2).setValues(out);
  sheet.getRange(1, 2, 1, 2).setValues([['試合ID', '陣営ID']]);

  rebuildIdSheetsCore_(ss);
}

function formatEigomon() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('画像解析データ');
  if (!sheet) { sheet = ss.getActiveSheet(); sheet.setName('画像解析データ'); }
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (!lr || !lc) return;
  const data = sheet.getRange(1,1,lr,lc).getValues();
  const imageRows = {};
  const imageCols = {};
  for (let r=0;r<data.length;r++) {
    for (let c=0;c<data[r].length;c++) {
      const val = String(data[r][c]).trim();
      if (val.indexOf('englishstoryserver.com/Icon/Icon/Icon') !== -1) {
        sheet.getRange(r+1,c+1).setFormula('=IMAGE("' + val + '")');
        imageRows[r+1] = true;
        imageCols[c+1] = true;
      }
    }
  }
  Object.keys(imageRows).forEach(r => sheet.setRowHeight(Number(r), 35));
  Object.keys(imageCols).forEach(c => sheet.setColumnWidth(Number(c), 35));
  sheet.setColumnWidth(7, 21);
}