'use client'

// 장비 **라인업 마스터**를 화면으로 나르는 한 곳 (2026-11-26).
//
// 표는 셋이다 — 라인업 → 모델 → 구성(db/equipment_master_20261126.sql).
// 화면은 그 셋을 한 번에 읽어 **나무 하나**로 들고 쓴다(장비 등록·수정 폼의 세 칸).
//
// ── 표가 아직 없어도 화면은 돈다 ─────────────────────────────────────────
//   SQL 을 돌리기 전에는 조회가 42P01(PGRST205, 없는 표)로 떨어진다. 그때는 **빈 마스터**를
//   돌려주고, 폼은 세 칸을 그냥 자유 입력으로 쓴다(지금까지와 같다).
//
// 모듈 캐시다 — 앱이 살아 있는 동안 한 번만 읽는다(목록이 자주 바뀌지 않는다).

import { createClient } from '@/lib/supabase/client'

export type MasterConfig = { id: number; name: string }
export type MasterModel = { id: number; name: string; configs: MasterConfig[] }
export type MasterLineup = { id: number; name: string; line: string; models: MasterModel[] }
export type EquipmentMaster = {
  lineups: MasterLineup[]
  /** 표가 없거나 읽지 못했는가 — 그때는 자유 입력만 쓴다. */
  empty: boolean
}

export const EMPTY_MASTER: EquipmentMaster = { lineups: [], empty: true }

let cache: Promise<EquipmentMaster> | null = null

/** 권한·세션이 바뀌면 버린다. */
export function invalidateEquipmentMaster(): void { cache = null }

/** 라인업 → 모델 → 구성. 앱 당 한 번만 읽는다. */
export function loadEquipmentMaster(): Promise<EquipmentMaster> {
  if (cache) return cache
  cache = (async (): Promise<EquipmentMaster> => {
    const sb = createClient()
    const [lu, mo, cf] = await Promise.all([
      sb.from('equipment_lineups').select('id, name, line, sort, active').order('sort').order('name'),
      sb.from('equipment_models').select('id, lineup_id, name, active').order('name'),
      sb.from('equipment_configs').select('id, model_id, name, active').order('name'),
    ])
    if (lu.error || !lu.data) {
      // 표가 아직 없다(PGRST205) — 자유 입력으로 돈다. 한 번만 알린다.
      console.warn('[equipmentMaster] 마스터를 읽지 못했다 — 자유 입력으로 돈다', lu.error?.code)
      cache = null
      return EMPTY_MASTER
    }
    const models = new Map<number, MasterModel[]>()
    const configs = new Map<number, MasterConfig[]>()
    for (const c of cf.data ?? []) {
      if (c.active === false) continue
      const list = configs.get(Number(c.model_id)) ?? []
      list.push({ id: Number(c.id), name: String(c.name) })
      configs.set(Number(c.model_id), list)
    }
    for (const m of mo.data ?? []) {
      if (m.active === false) continue
      const list = models.get(Number(m.lineup_id)) ?? []
      list.push({ id: Number(m.id), name: String(m.name), configs: configs.get(Number(m.id)) ?? [] })
      models.set(Number(m.lineup_id), list)
    }
    const lineups: MasterLineup[] = (lu.data ?? [])
      .filter(l => l.active !== false)
      .map(l => ({
        id: Number(l.id), name: String(l.name), line: String(l.line ?? '80'),
        models: models.get(Number(l.id)) ?? [],
      }))
    return { lineups, empty: lineups.length === 0 }
  })()
  return cache
}

/** 적은 글자에 맞는 것만(비면 전부). 고르는 칸이 처음부터 목록을 보여 준다. */
export const filterByQuery = <T extends { name: string }>(items: T[], q: string): T[] => {
  const s = q.trim().toLowerCase()
  return s ? items.filter(i => i.name.toLowerCase().includes(s)) : items
}

/**
 * 적어 넣은 셋이 **마스터 밖**인가 — 하나라도 목록에 없으면 참이다.
 * 마스터가 비어 있으면(표가 없거나 20 라인업) **거짓**이다 — 자유 입력이 정상인 자리다.
 */
export function isMasterPending(
  master: EquipmentMaster,
  lineup: string, model: string, config: string,
): boolean {
  if (master.empty) return false
  const lu = master.lineups.find(l => l.name === lineup.trim())
  if (!lu) return lineup.trim() !== ''
  if (!model.trim()) return false
  const mo = lu.models.find(m => m.name === model.trim())
  if (!mo) return true
  if (!config.trim()) return false
  return !mo.configs.some(c => c.name === config.trim())
}
