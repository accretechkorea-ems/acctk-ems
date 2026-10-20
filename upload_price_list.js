// upload_price_list.js
//
// ⚠⚠ 사용 금지 (2026-10-20) ⚠⚠
//   이 스크립트는 price_list 를 **통째로 지우고** 다시 넣는다(아래 DELETE price_list?id=gte.0).
//   지금 DB 에서는 그래서는 안 된다 —
//     · quote_items.price_list_id 가 price_list 를 참조한다(ON DELETE 없음 = NO ACTION).
//       참조된 행을 지우려 하면 오류가 나고, 지워진다면 그만큼 지난 견적과의 연결이 끊어진다.
//     · price_list 의 anon 쓰기는 막혀 있다(쓰기는 서버 service role 만).
//     · variant(Jig 포함/제외) 칸을 모른다 — 두 줄로 저장된 품목이 뭉개진다.
//
//   대신 **화면의 「가격표 등록」을 쓴다** (/admin → 가격표 등록).
//   종류(시트)별로 덮어쓰고, 파일에 없는 품목은 그대로 두며, 한 트랜잭션으로 적용된다.
//   관련 코드: components/admin/priceList/ · app/api/price-list-import/route.ts ·
//             lib/priceListParse.ts · price_list_import_schema.sql
//
//   지우지 않고 남겨 둔 이유는 **예전 가져오기 방식의 기록**이기 때문이다 —
//   지금 DB 의 item_name_jp·model_jp 가 어느 엑셀 열에서 왔는지가 이 파일의 열 계산에 적혀 있다.
const XLSX = require('xlsx');
const https = require('https');
const fs = require('fs');

// 실행 전 환경변수 설정: export SUPABASE_ANON_KEY=<키값>
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_KEY) { console.error('SUPABASE_ANON_KEY 환경변수를 설정해주세요.'); process.exit(1); }

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error('파일을 찾을 수 없어요:', filePath);
  process.exit(1);
}

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'qyewhpdvtixxrcuvfrzj.supabase.co',
      path: '/rest/v1/' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(resData);
        else reject(new Error('HTTP ' + res.statusCode + ': ' + resData.slice(0, 300)));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function findHeaderCols(rows) {
  // 헤더행(행1)에서 정가/구입가 컬럼 위치 찾기
  // XLSX는 첫번째 빈컬럼 무시하므로 openpyxl 인덱스 - 1
  const header = rows[1] || [];
  let plntCol = -1, itemCodeCol = -1, priceCol = -1, costCol = -1;
  header.forEach((v, i) => {
    if (!v) return;
    const s = String(v).replace(/\n/g, ' ').trim();
    if (s === 'Plnt') plntCol = i;
    if (s === 'Item code') itemCodeCol = i;
    if (s.includes('販売定価') || s.startsWith('List price')) priceCol = i;
    if (s.includes('仕切り') || s.startsWith('Net price')) costCol = i;
  });
  return { plntCol, itemCodeCol, priceCol, costCol };
}

function parseSheet(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  const today = new Date().toISOString().slice(0, 10);

  const { plntCol, itemCodeCol, priceCol, costCol } = findHeaderCols(rows);

  if (itemCodeCol < 0 || priceCol < 0 || costCol < 0) {
    console.log('  컬럼 감지 실패 스킵 (itemCode:' + itemCodeCol + ' price:' + priceCol + ' cost:' + costCol + ')');
    return [];
  }

  const grpCol = itemCodeCol - 1;
  const plntC = plntCol >= 0 ? plntCol : itemCodeCol - 2;
  const nameJpCol = itemCodeCol + 1;
  const modelJpCol = itemCodeCol + 2;

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const itemCode = row[itemCodeCol] != null ? String(row[itemCodeCol]).trim() : '';
    if (!itemCode || itemCode === 'Item code') continue;

    result.push({
      sheet_name:   sheetName,
      plnt:         row[plntC]      != null ? String(row[plntC])      : null,
      grp:          row[grpCol]     != null ? String(row[grpCol])     : null,
      item_code:    itemCode,
      item_name_jp: row[nameJpCol]  != null ? String(row[nameJpCol])  : null,
      model_jp:     row[modelJpCol] != null ? String(row[modelJpCol]) : null,
      note1_jp:     row[modelJpCol+1] != null ? String(row[modelJpCol+1]) : null,
      note2_jp:     row[modelJpCol+2] != null ? String(row[modelJpCol+2]) : null,
      note3_jp:     row[modelJpCol+3] != null ? String(row[modelJpCol+3]) : null,
      item_name_en: null,
      model_en:     null,
      note1_en:     null,
      note2_en:     null,
      note3_en:     null,
      price_jpy:    row[priceCol] != null ? (parseInt(row[priceCol]) || null) : null,
      cost_jpy:     row[costCol]  != null ? (parseInt(row[costCol])  || null) : null,
      updated_at:   today,
    });
  }
  return result;
}

async function uploadBatch(items) {
  const BATCH = 200;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await supabaseRequest('POST', 'price_list', batch);
    process.stdout.write('\r  ' + Math.min(i + BATCH, items.length) + ' / ' + items.length);
  }
  console.log('');
}

async function main() {
  console.log('\n파일: ' + filePath);
  const wb = XLSX.readFile(filePath);

  console.log('기존 데이터 삭제 중...');
  await supabaseRequest('DELETE', 'price_list?id=gte.0', null);
  console.log('삭제 완료!');

  let total = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const items = parseSheet(ws, sheetName);
    if (items.length === 0) { console.log('[' + sheetName + '] 스킵'); continue; }

    const s = items[0];
    console.log('[' + sheetName + '] ' + items.length + '개');
    console.log('  샘플: plnt=' + s.plnt + ' / grp=' + s.grp + ' / item_code=' + s.item_code + ' / model_jp=' + s.model_jp + ' / 정가=' + s.price_jpy + ' / 구입가=' + s.cost_jpy);
    await uploadBatch(items);
    total += items.length;
    console.log('[' + sheetName + '] 완료!');
  }
  console.log('\n전체 완료! 총 ' + total + '개');
}

main().catch(e => { console.error(e.message); process.exit(1); });
