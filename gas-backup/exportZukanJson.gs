// jsonファイル作成.gs のバックアップ
// 最終更新: 2026-06-13
// GASエディタから全文コピペして、この下に貼り付ける

function exportZukanJson() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('図鑑マスター');
  if (!sh || sh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('図鑑マスターが空です');
    return;
  }
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const data = rows.map(function(r) {
    return {d: r[0], c: r[1], s: r[2], h: r[3], n: r[4], u: r[5]};
  }).filter(function(x) { return x.n; });

  var json = JSON.stringify(data);
  DriveApp.createFile('zukan.json', json, MimeType.PLAIN_TEXT);
  SpreadsheetApp.getUi().alert('完了\n件数: ' + data.length + '\nサイズ: ' + (json.length / 1024).toFixed(0) + 'KB');
}