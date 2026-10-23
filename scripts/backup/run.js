// 주 1회 백업 — DB 표 전체(JSON)와 스토리지 파일 전부를 PC 로 받는다.
//
//   npm run backup                     기본 위치에 받는다
//   npm run backup -- D:\ems-backup    위치를 지정한다
//
// 받는 곳(앞에 있는 것이 이긴다): 명령 인자 > .env.local 의 BACKUP_DIR > C:\Users\admin\ems-backup
// 그 아래에 날짜 폴더가 생긴다 — <받는 곳>\YYYYMMDD\
//
// ── 왜 pg_dump 가 기본이 아닌가 ──────────────────────────────────────────────
// pg_dump 는 PostgreSQL 을 설치해야 생기는 명령이고 이 PC 에는 없다(확인했다).
// 그래서 **Supabase REST 로 표를 통째로 읽어 JSON 으로** 받는 것을 기본으로 둔다.
// 받는 것은 **자료**다 — 표 구조·제약·RLS 정책·함수는 들어오지 않는다(그쪽은 저장소의
// *.sql 과 _schema.json 이 기록이다). 그래서 이 백업만으로 빈 프로젝트를 되살릴 수는 없고,
// 「어제 지운 행을 되돌리는 일」에 쓴다. 전체 복원은 Supabase 일일 백업(7일)이 먼저다 —
// docs/복구절차.md 를 보라.
//
// pg_dump 가 PATH 에 있고 .env.local 에 SUPABASE_DB_URL 이 있으면 db.sql.gz 도 함께 받는다
// (그쪽이 구조까지 들어 있는 진짜 덤프다).
//
// ── 비밀 ────────────────────────────────────────────────────────────────────
// 키는 .env.local 에서 읽고 **로그·manifest 어디에도 찍지 않는다.** 받은 폴더에는
// 고객 자료가 들어 있으니 공유 폴더에 두지 마라(docs/복구절차.md 의 보관 규칙).

// eslint 의 no-require-imports 는 맨 require() 를 센다. 이 파일은 node 로 직접 돌리는
// CJS 스크립트라 모듈을 그렇게 불러올 수밖에 없다 — 하네스와 같이 한 번만 묶어 둔다.
const load = module.require.bind(module)
const fs = load('fs')
const path = load('path')
const { spawnSync } = load('child_process')
const { createGzip } = load('zlib')

const ROOT = path.join(__dirname, '..', '..')
const DEFAULT_DIR = 'C:\\Users\\admin\\ems-backup'
/** 이보다 오래된 날짜 폴더는 **알려만 준다**(지우는 것은 사람이 한다). */
const KEEP_WEEKS = 8
/** 한 번에 읽는 줄 수. PostgREST 의 기본 상한과 맞춘다. */
const PAGE = 1000

// ── .env.local ──────────────────────────────────────────────────────────────
function envLocal() {
  const f = path.join(ROOT, '.env.local')
  if (!fs.existsSync(f)) {
    console.error('.env.local 이 없다 — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요하다')
    process.exit(1)
  }
  const out = {}
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = envLocal()
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다')
  process.exit(1)
}
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// ── 받는 곳 ─────────────────────────────────────────────────────────────────
const argDir = process.argv.slice(2).find(a => !a.startsWith('-'))
const BASE = argDir || env.BACKUP_DIR || DEFAULT_DIR
const now = new Date()
const pad = n => String(n).padStart(2, '0')
const STAMP = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
const OUT = path.join(BASE, STAMP)
const DB_DIR = path.join(OUT, `db-${STAMP}`)
const ST_DIR = path.join(OUT, `storage-${STAMP}`)

const mb = b => (b / 1024 / 1024).toFixed(1)
const n = v => Number(v).toLocaleString('ko-KR')

// ── 재시도 ──────────────────────────────────────────────────────────────────
// 백업이 네트워크 한 번 끊겨 통째로 실패하면 안 된다. 세 번까지 다시 해 본다.
async function get(url, opts = {}, tries = 3) {
  let last
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...HEAD, ...(opts.headers || {}) } })
      if (r.ok) return r
      last = new Error(`HTTP ${r.status}`)
      // 4xx 는 다시 해도 같다(권한·주소 문제) — 바로 포기한다.
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break
    } catch (e) { last = e }
    await new Promise(res => setTimeout(res, 500 * i))
  }
  throw last ?? new Error('알 수 없는 오류')
}

// ── ① 표 목록·구조 ──────────────────────────────────────────────────────────
async function loadSchema() {
  const r = await get(`${URL_BASE}/rest/v1/`)
  const spec = await r.json()
  const defs = spec.definitions || spec.components?.schemas || {}
  const tables = Object.keys(spec.paths || {})
    .filter(p => p !== '/' && !p.startsWith('/rpc/'))
    .map(p => p.slice(1))
    .sort()
  const pkOf = {}
  for (const t of tables) {
    const props = defs[t]?.properties || {}
    pkOf[t] = Object.entries(props)
      .filter(([, p]) => /Primary Key/i.test(p.description || ''))
      .map(([k]) => k)
  }
  const fns = Object.keys(spec.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)).sort()
  return { spec, tables, pkOf, fns }
}

// ── ② 표 하나 받기 ──────────────────────────────────────────────────────────
/**
 * 페이지를 넘기며 전부 읽는다.
 *
 * **정렬이 중요하다** — order 없이 offset 을 쓰면 Postgres 가 줄 순서를 보장하지 않아
 * 페이지 사이에서 같은 줄이 두 번 오거나 빠질 수 있다. 그래서 기본키로 정렬한다.
 * 기본키가 없는 표(백업 사본 넷)는 정렬 없이 받고 manifest 에 그 사실을 적는다.
 */
async function dumpTable(table, pk) {
  const order = pk.length ? `&order=${pk.map(c => `${c}.asc`).join(',')}` : ''
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const url = `${URL_BASE}/rest/v1/${table}?select=*${order}&limit=${PAGE}&offset=${offset}`
    const r = await get(url)
    const page = await r.json()
    if (!Array.isArray(page)) throw new Error('응답이 배열이 아니다')
    rows.push(...page)
    if (page.length < PAGE) break
    // 안전장치 — 표 하나가 50만 줄을 넘으면 뭔가 잘못된 것이다.
    if (rows.length > 500000) throw new Error('줄이 50만을 넘었다 — 멈춘다')
  }
  const file = path.join(DB_DIR, `${table}.json`)
  fs.writeFileSync(file, JSON.stringify(rows, null, 1))
  return { rows: rows.length, bytes: fs.statSync(file).size, ordered: pk.length > 0 }
}

// ── ③ 스토리지 ──────────────────────────────────────────────────────────────
async function listFolder(bucket, prefix) {
  const r = await get(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  })
  return r.json()
}

/** 폴더를 훑어 파일을 내려받는다. 이미 **같은 크기**로 있으면 건너뛴다(두 번째부터 빠르다). */
async function dumpBucket(bucket, prefix, acc, depth = 0) {
  const items = await listFolder(bucket, prefix)
  for (const o of items) {
    const rel = prefix ? `${prefix}/${o.name}` : o.name
    // id 가 null 이면 폴더다. 너무 깊이 들어가지 않는다(지금 구조는 2단을 넘지 않는다).
    if (o.id === null) {
      if (depth < 4) await dumpBucket(bucket, rel, acc, depth + 1)
      continue
    }
    const size = o.metadata?.size ?? 0
    const dest = path.join(ST_DIR, bucket, ...rel.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (fs.existsSync(dest) && fs.statSync(dest).size === size && size > 0) {
      acc.skipped += 1
      acc.skippedBytes += size
      continue
    }
    const r = await get(`${URL_BASE}/storage/v1/object/${bucket}/${rel.split('/').map(encodeURIComponent).join('/')}`)
    const buf = Buffer.from(await r.arrayBuffer())
    fs.writeFileSync(dest, buf)
    acc.files += 1
    acc.bytes += buf.length
  }
}

// ── ④ pg_dump(있으면) ───────────────────────────────────────────────────────
function tryPgDump() {
  // shell 없이 부른다 — 없으면 ENOENT 가 온다(shell 을 켜고 인자를 넘기면 node 가 경고한다).
  const probe = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return { ran: false, why: 'pg_dump 가 PATH 에 없다(PostgreSQL 미설치)' }
  if (!env.SUPABASE_DB_URL) return { ran: false, why: 'pg_dump 는 있는데 .env.local 에 SUPABASE_DB_URL 이 없다' }
  const dest = path.join(OUT, 'db.sql.gz')
  const p = spawnSync('pg_dump', [env.SUPABASE_DB_URL, '--no-owner', '--no-privileges'], {
    encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024,
  })
  if (p.status !== 0) {
    return { ran: false, why: `pg_dump 가 실패했다(종료 코드 ${p.status}) — 접속 문자열을 확인하라` }
  }
  // 통째로 들고 있지 않고 흘려 쓴다.
  return new Promise(resolve => {
    const gz = createGzip()
    const out = fs.createWriteStream(dest)
    gz.pipe(out)
    gz.end(p.stdout)
    out.on('finish', () => resolve({ ran: true, bytes: fs.statSync(dest).size, version: probe.stdout.trim() }))
    out.on('error', e => resolve({ ran: false, why: String(e).slice(0, 120) }))
  })
}

// ── ⑤ 오래된 폴더 알림 ─────────────────────────────────────────────────────
function oldFolders() {
  if (!fs.existsSync(BASE)) return []
  const limit = Date.now() - KEEP_WEEKS * 7 * 24 * 3600 * 1000
  return fs.readdirSync(BASE, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{8}$/.test(e.name) && e.name !== STAMP)
    .filter(e => {
      const y = +e.name.slice(0, 4), m = +e.name.slice(4, 6), d = +e.name.slice(6, 8)
      return new Date(y, m - 1, d).getTime() < limit
    })
    .map(e => e.name)
    .sort()
}

// ── 실행 ────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  fs.mkdirSync(DB_DIR, { recursive: true })
  fs.mkdirSync(ST_DIR, { recursive: true })
  console.log(`백업 시작 — ${OUT}`)

  // 표
  const { spec, tables, pkOf, fns } = await loadSchema()
  fs.writeFileSync(path.join(DB_DIR, '_schema.json'), JSON.stringify(spec, null, 1))
  console.log(`\n표 ${tables.length}개 · 함수 ${fns.length}개 (구조는 _schema.json)`)
  const tableRows = []
  for (const t of tables) {
    process.stdout.write(`  ${t.padEnd(40)}`)
    try {
      const r = await dumpTable(t, pkOf[t] ?? [])
      tableRows.push({ table: t, ...r, pk: pkOf[t] ?? [] })
      console.log(`${String(n(r.rows)).padStart(8)}줄 ${String(mb(r.bytes)).padStart(7)}MB${r.ordered ? '' : '  (기본키 없음 — 정렬 없이 받았다)'}`)
    } catch (e) {
      tableRows.push({ table: t, rows: null, bytes: 0, error: String(e).slice(0, 120), pk: pkOf[t] ?? [] })
      console.log(`실패 — ${String(e).slice(0, 80)}`)
    }
  }

  // 스토리지
  const bRes = await get(`${URL_BASE}/storage/v1/bucket`)
  const buckets = await bRes.json()
  console.log(`\n버킷 ${buckets.length}개`)
  const bucketRows = []
  for (const b of buckets) {
    const acc = { files: 0, bytes: 0, skipped: 0, skippedBytes: 0 }
    process.stdout.write(`  ${b.name.padEnd(28)}`)
    try {
      await dumpBucket(b.name, '', acc)
      bucketRows.push({ bucket: b.name, public: !!b.public, ...acc })
      console.log(`새로 ${String(acc.files).padStart(4)}개 ${String(mb(acc.bytes)).padStart(7)}MB · 건너뜀 ${acc.skipped}개`)
    } catch (e) {
      bucketRows.push({ bucket: b.name, public: !!b.public, ...acc, error: String(e).slice(0, 120) })
      console.log(`실패 — ${String(e).slice(0, 80)}`)
    }
  }

  // pg_dump
  const pg = await tryPgDump()
  console.log(`\npg_dump: ${pg.ran ? `받았다 — db.sql.gz ${mb(pg.bytes)}MB (${pg.version})` : `건너뜀 — ${pg.why}`}`)

  // 요약
  const okTables = tableRows.filter(r => r.rows != null)
  const failed = [...tableRows.filter(r => r.error), ...bucketRows.filter(r => r.error)]
  const totalRows = okTables.reduce((s, r) => s + r.rows, 0)
  const dbBytes = okTables.reduce((s, r) => s + r.bytes, 0)
  const stFiles = bucketRows.reduce((s, r) => s + r.files + r.skipped, 0)
  const stBytes = bucketRows.reduce((s, r) => s + r.bytes + r.skippedBytes, 0)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  const manifest = {
    when: new Date().toISOString(),
    stamp: STAMP,
    dest: OUT,
    totals: {
      tables: okTables.length, tablesFailed: tableRows.length - okTables.length,
      rows: totalRows, dbBytes,
      buckets: bucketRows.length, storageFiles: stFiles, storageBytes: stBytes,
      seconds: Number(secs),
    },
    pgDump: pg.ran ? { ran: true, bytes: pg.bytes } : { ran: false, why: pg.why },
    tables: tableRows,
    buckets: bucketRows,
    functions: fns,
    note: 'JSON 백업은 **자료**만이다 — 표 구조·제약·RLS·함수는 들어 있지 않다(_schema.json 과 저장소의 *.sql 이 기록). 복구는 docs/복구절차.md.',
    warning: '한 시점의 스냅샷이 아니다 — 받는 데 몇 분이 걸리므로 그 사이에 들어온 쓰기는 표마다 다르게 잡힌다(기록용 표 audit_log·download_logs 에서 특히 보인다). 사람이 쓰지 않는 시간에 돌려라.',
  }
  fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 1))

  console.log('\n' + '─'.repeat(64))
  console.log(`표      ${okTables.length}/${tableRows.length}개 · ${n(totalRows)}줄 · ${mb(dbBytes)}MB`)
  console.log(`스토리지 ${bucketRows.length}개 버킷 · ${n(stFiles)}파일 · ${mb(stBytes)}MB`)
  console.log(`걸린 시간 ${secs}초 · ${OUT}`)
  if (failed.length) {
    console.log(`\n실패 ${failed.length}건:`)
    for (const f of failed) console.log(`  ${f.table ?? f.bucket}: ${f.error}`)
  }
  const old = oldFolders()
  if (old.length) {
    console.log(`\n${KEEP_WEEKS}주보다 오래된 폴더 ${old.length}개 — 지우려면 사람이 지운다(이 스크립트는 지우지 않는다):`)
    for (const o of old) console.log(`  ${path.join(BASE, o)}`)
  }
  console.log('\n외장 하드나 NAS 에 이 폴더를 한 벌 더 복사해 두라 — 이 PC 가 고장나면 같이 간다.')
  if (failed.length) process.exit(1)
}

main().catch(e => { console.error('\n백업 실패:', String(e).slice(0, 300)); process.exit(1) })
