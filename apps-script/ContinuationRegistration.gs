/**
 * 小6朝学習・継続登録 API（公開前の下書き）
 * 既存名簿の A列:生徒ID / B列:氏名 / C列:校舎 / D列:利用状態を参照。
 * 既存名簿は読み取りのみ。登録記録は「継続登録」シートに分離。
 *
 * スクリプトプロパティ ROSTER_SPREADSHEET_ID を設定し、
 * 管理者権限で初期化: setupContinuationRegistration()
 * Webアプリはスクリプト所有者として実行すること。
 */
const CONTINUATION = Object.freeze({
  rosterSheet: '生徒名簿',
  enrollmentSheet: '継続登録',
  cutoff: '2026-11-01',
  testIds: ['12345678'],
});
function continuationBook_() {
  const id = PropertiesService.getScriptProperties().getProperty('ROSTER_SPREADSHEET_ID');
  if (!id) throw new Error('ROSTER_SPREADSHEET_ID 未設定');
  return SpreadsheetApp.openById(id);
}
function setupContinuationRegistration() {
  const book = continuationBook_();
  if (!book.getSheetByName(CONTINUATION.rosterSheet)) throw new Error('生徒名簿がありません');
  let sheet = book.getSheetByName(CONTINUATION.enrollmentSheet);
  if (!sheet) sheet = book.insertSheet(CONTINUATION.enrollmentSheet);
  if (!sheet.getLastRow()) sheet.appendRow(['生徒ID', '登録日時', '継続希望', '管理者停止', '更新日時']);
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.setFrozenRows(1);
}
function student_(id) {
  if (!/^\\d{8}$/.test(String(id || ''))) return null;
  const sh = continuationBook_().getSheetByName(CONTINUATION.rosterSheet);
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues();
  const row = rows.find(row => row[0] === id);
  return row ? { id, name: row[1], campus: row[2], enabled: row[3] !== '利用停止' && row[3].toLowerCase() !== 'false' } : null;
}
function registrationRow_(id) {
  const sh = continuationBook_().getSheetByName(CONTINUATION.enrollmentSheet);
  if (!sh) throw new Error('初期化が必要です');
  const vals = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const i = vals.findIndex(row => String(row[0]) === id);
  return { sh, index: i < 0 ? -1 : i + 2, row: i < 0 ? null : vals[i] };
}
function isContinuationAllowed_(id, today) {
  if (today < CONTINUATION.cutoff) return true;
  const student = student_(id);
  if (!student || !student.enabled) return false;
  const reg = registrationRow_(id).row;
  return !!(reg && reg[2] === true && reg[3] !== true);
}
function tokyoToday_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function output_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function error_(code, message) { return { ok: false, code, message }; }
/**
 * 呼び出し元にはIDと氏名を照合するための最小情報のみ返す。
 * 本人認証ではない。連続試行への対策はAPIゲートウェイで行うこと。
 */
function doGet(e) {
  const action = String(e && e.parameter && e.parameter.action || '');
  if (action !== 'lookup') return output_(error_('ACTION', '未対応の操作です'));
  return output_(lookupStudent_(e.parameter.studentId));
}
function lookupStudent_(id) {
  try {
    id = String(id || '');
    const student = student_(id);
    if (!student || !student.enabled || CONTINUATION.testIds.includes(id)) {
      return error_('NOT_FOUND', '生徒IDを確認してください');
    }
    const reg = registrationRow_(id);
    return { ok: true, studentId: id, name: student.name, campus: student.campus, registered: !!(reg.row && reg.row[2] === true && reg.row[3] !== true) };
  } catch (err) { return error_('SERVER', '現在確認できません'); }
}
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents || '{}');
    if (request.action !== 'enroll') return output_(error_('ACTION', '未対応の操作です'));
    return output_(enroll_(request.studentId, request.confirmedName));
  } catch (err) { return output_(error_('SERVER', '登録を確認できません')); }
}
function enroll_(id, confirmedName) {
  id = String(id || '');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return error_('BUSY', '時間をおいて再試行してください');
  try {
    const student = student_(id);
    if (!student || !student.enabled || CONTINUATION.testIds.includes(id) || !student.name ||
        student.name !== String(confirmedName || '')) return error_('INVALID', '生徒情報を確認してください');
    const r = registrationRow_(id);
    if (r.row && r.row[3] === true) return error_('STOPPED', '管理者にお問い合わせください');
    const now = new Date();
    if (r.index > 0) {
      r.sh.getRange(r.index, 3, 1, 3).setValues([[true, false, now]]);
    } else {
      r.sh.appendRow([id, now, true, false, now]);
    }
    return { ok: true, registered: true, studentId: id };
  } finally { lock.releaseLock(); }
}
