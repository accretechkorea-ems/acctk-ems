'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Document, Page, Text, View, StyleSheet, Image, PDFViewer, Font, pdf
} from '@react-pdf/renderer'

Font.register({
  family: 'NotoSansCJK',
  src: 'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4hfeE.ttf',
})

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  email: string | null
  initials: string | null
}

type PriceItem = {
  id: number
  sheet_name: string
  item_code: string
  item_name_jp: string | null
  model_jp: string | null
  item_name_en: string | null
  model_en: string | null
  price_jpy: number | null
  cost_jpy: number | null
  delivery_time: string | null
  stock_quantity: number | null
}

type CustomerResult = {
  customer_id: number
  company_name: string
  address: string | null
  status: string | null
}

type QuoteRow = {
  id: string
  itemText: string
  selectedItem: PriceItem | null
  subLines: string[]
  quantity: number
  manual_unit_price: number
  tariff_rate: number
  exchange_rate: number
  profit_rate: number
  unit_price: number
  supply_price: number
  tax: number
  cost_price_jpy: number
  product_price: number
  profit: number
}

function calcRow(row: QuoteRow, rate: number): QuoteRow {
  const exRate = rate || row.exchange_rate
  if (row.selectedItem?.cost_jpy && exRate) {
    const costJpy = row.selectedItem.cost_jpy
    const rawUnit = (costJpy * exRate * row.tariff_rate) / (1 - row.profit_rate / 100)
    const unitPrice = Math.ceil(rawUnit / 1000) * 1000
    const supplyPrice = unitPrice * row.quantity
    const tax = Math.round(supplyPrice * 0.1)
    const productPrice = Math.round(costJpy * exRate * row.tariff_rate * row.quantity)
    return {
      ...row, exchange_rate: exRate,
      cost_price_jpy: costJpy, unit_price: unitPrice,
      supply_price: supplyPrice, tax,
      product_price: productPrice, profit: supplyPrice - productPrice,
    }
  } else {
    const unitPrice = row.manual_unit_price
    const supplyPrice = unitPrice * row.quantity
    const tax = Math.round(supplyPrice * 0.1)
    return {
      ...row, exchange_rate: exRate,
      unit_price: unitPrice, supply_price: supplyPrice, tax,
      cost_price_jpy: 0, product_price: 0, profit: supplyPrice,
    }
  }
}

function createRow(): QuoteRow {
  return {
    id: Math.random().toString(36).slice(2),
    itemText: '', selectedItem: null, subLines: [],
    quantity: 1, manual_unit_price: 0,
    tariff_rate: 1.13, exchange_rate: 0, profit_rate: 40,
    unit_price: 0, supply_price: 0, tax: 0,
    cost_price_jpy: 0, product_price: 0, profit: 0,
  }
}

const numKR = (n: number) => n.toLocaleString('ko-KR')

function amountToKorean(n: number): string {
  if (n === 0) return '영원 정'
  const units = ['', '만', '억', '조']
  const nums = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  let result = '', unitIdx = 0, num = n
  while (num > 0) {
    const chunk = num % 10000
    if (chunk > 0) {
      let s = ''
      const t = Math.floor(chunk / 1000), h = Math.floor((chunk % 1000) / 100)
      const te = Math.floor((chunk % 100) / 10), o = chunk % 10
      if (t > 0) s += (t > 1 ? nums[t] : '') + '천'
      if (h > 0) s += (h > 1 ? nums[h] : '') + '백'
      if (te > 0) s += (te > 1 ? nums[te] : '') + '십'
      if (o > 0) s += nums[o]
      result = s + units[unitIdx] + result
    }
    num = Math.floor(num / 10000); unitIdx++
  }
  return result + '원 정'
}

const THICK = 1.3
const THIN = 0.5
const COL = { name: '48%', qty: '7%', unit: '15%', supply: '17%', tax: '13%' }

const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansCJK', fontSize: 9,
    paddingTop: 38, paddingBottom: 25, paddingLeft: 30, paddingRight: 30,
    backgroundColor: '#ffffff',
  },
  titleText: { fontSize: 22, fontFamily: 'NotoSansCJK', letterSpacing: 8, textAlign: 'center', paddingBottom: 3 },
  dateRow: { textAlign: 'center', fontSize: 10, marginBottom: 10 },
  headerRow: { flexDirection: 'row', marginBottom: 4 },
  headerLeft: { flex: 1 },
  companyName: { fontSize: 12, fontFamily: 'NotoSansCJK', textDecoration: 'underline', marginBottom: 4 },
  headerSubText: { fontSize: 10, marginBottom: 5 },
  conditionRow: { flexDirection: 'row', marginBottom: 3 },
  conditionLabel: { fontSize: 10, width: 85, paddingLeft: 8 },
  conditionValue: { fontSize: 10 },
  headerRight: { width: 195, alignItems: 'flex-start' },
  logo: { width: 125, height: 30, marginBottom: 4 },
  headerRightText: { fontSize: 9.5, textAlign: 'left', marginBottom: 2 },
  dividerBox: {
    borderTopWidth: THICK, borderColor: '#000',
    paddingVertical: 4, marginTop: 5, marginBottom: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
  },
  dividerText: { fontSize: 11, fontFamily: 'NotoSansCJK', textAlign: 'center' },
  table: { width: '100%', borderWidth: THICK, borderColor: '#000' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f4a460', borderBottomWidth: THICK, borderBottomColor: '#000' },
  th: { borderRightWidth: THICK, borderRightColor: '#000', paddingVertical: 1, paddingHorizontal: 3, fontFamily: 'NotoSansCJK', fontSize: 9, textAlign: 'center' },
  thLast: { paddingVertical: 1, paddingHorizontal: 3, fontFamily: 'NotoSansCJK', fontSize: 9, textAlign: 'center' },
  itemRow: { flexDirection: 'row', borderTopWidth: THIN, borderTopColor: '#999', minHeight: 16 },
  td: { borderRightWidth: THICK, borderRightColor: '#000', paddingVertical: 3, paddingHorizontal: 4, fontSize: 9 },
  tdLast: { paddingVertical: 3, paddingHorizontal: 4, fontSize: 9 },
  remarkRow: { flexDirection: 'row', minHeight: 80 },
  remarkContent: { flex: 1, borderRightWidth: THICK, borderRightColor: '#000', padding: 6 },
  remarkLine: { fontSize: 8.5, marginBottom: 2 },
  summaryRow: { flexDirection: 'row', borderTopWidth: THICK, borderTopColor: '#000', height: 22, alignItems: 'center' },
})

type PDFDocProps = {
  company: string; receiver: string; quoteNo: string; dateDisplay: string
  titleItem: string; rows: QuoteRow[]; remarks: string; engineerName: string
  totalSupply: number; totalTax: number; totalAmount: number
  showWatermark?: boolean
}

const QuotePDFDoc = React.memo(function QuotePDFDoc({ company, receiver, quoteNo, dateDisplay, titleItem, rows, remarks, engineerName, totalSupply, totalTax, totalAmount, showWatermark }: PDFDocProps) {
  const EMPTY_ROWS = Math.max(0, 10 - rows.length)
  return (
    <Document>
      <Page size="A4" style={S.page}>
        {showWatermark && (
          <View style={{ position: 'absolute', top: 180, left: 20, right: 20, alignItems: 'center', transform: 'rotate(-35deg)', zIndex: 999, opacity: 0.10 }}>
            <Text style={{ fontSize: 72, fontFamily: 'NotoSansCJK', color: '#000000', textAlign: 'center' }}>미리보기</Text>
            <Text style={{ fontSize: 36, fontFamily: 'NotoSansCJK', color: '#000000', textAlign: 'center', marginTop: 12 }}>{engineerName}</Text>
          </View>
        )}
        <View style={{ position: 'relative', marginBottom: 3 }}>
          <View style={{ alignItems: 'center', marginBottom: 0 }}>
            <Text style={S.titleText}>見　積　書</Text>
            <View style={{ height: 2, backgroundColor: '#000', width: 150, marginBottom: 2 }} />
            <View style={{ height: 2, backgroundColor: '#000', width: 150 }} />
          </View>
          <View style={{ position: 'absolute', right: 0, top: 8 }}>
            <Text style={{ fontSize: 9, textAlign: 'right', marginBottom: 3 }}>{quoteNo}</Text>
            {receiver ? <Text style={{ fontSize: 9, textAlign: 'right' }}>수신인 : {receiver}</Text> : null}
          </View>
        </View>
        <Text style={S.dateRow}>西紀　{dateDisplay}</Text>
        <View style={S.headerRow}>
          <View style={S.headerLeft}>
            <Text style={S.companyName}>{company || '　'} 貴下</Text>
            <Text style={S.headerSubText}>下記와 如히 견적함</Text>
            {[['1.납품일정 :', '담당자와 협의'], ['2.지불조건 :', '현금'], ['3.인도조건 :', '지정장소'], ['4.견적유효 :', '작성일로부터 1개월']].map(([label, val]) => (
              <View key={label} style={S.conditionRow}>
                <Text style={S.conditionLabel}>{label}</Text>
                <Text style={S.conditionValue}>{val}</Text>
              </View>
            ))}
          </View>
          <View style={S.headerRight}>
            <Image src="/quotelogo.png" style={S.logo} />
            <Text style={S.headerRightText}>화성시 동탄대로 24길 31-8</Text>
            <Text style={S.headerRightText}>Accretech Korea Co., Ltd.</Text>
            <Text style={S.headerRightText}>대표이사 이상철</Text>
            <Text style={S.headerRightText}>대표전화 031)786-4093</Text>
          </View>
        </View>
        <View style={S.dividerBox}>
          <Text style={S.dividerText}>一金　　{amountToKorean(totalSupply)}　　({totalSupply > 0 ? `₩${numKR(totalSupply)}` : '₩0'} -)　　부가세 별도</Text>
        </View>
        <View style={S.table}>
          <View style={S.tableHeader}>
            <Text style={[S.th, { width: COL.name }]}>品　　名</Text>
            <Text style={[S.th, { width: COL.qty }]}>數量</Text>
            <Text style={[S.th, { width: COL.unit }]}>單價</Text>
            <Text style={[S.th, { width: COL.supply }]}>供給價額</Text>
            <Text style={[S.thLast, { width: COL.tax }]}>附加稅</Text>
          </View>
          {titleItem ? (
            <View style={{ flexDirection: 'row', borderBottomWidth: THICK, borderBottomColor: '#000' }}>
              <View style={[S.td, { width: COL.name, paddingVertical: 2 }]}>
                <Text style={{ textAlign: 'center', fontFamily: 'NotoSansCJK', fontSize: 9 }}>{titleItem}</Text>
              </View>
              <View style={[S.td, { width: COL.qty }]} /><View style={[S.td, { width: COL.unit }]} />
              <View style={[S.td, { width: COL.supply }]} /><View style={[S.tdLast, { width: COL.tax }]} />
            </View>
          ) : null}
          {rows.map((row) => (
            <View key={row.id} style={[S.itemRow, { borderBottomWidth: THICK, borderBottomColor: '#000' }]}>
              <View style={[S.td, { width: COL.name }]}>
                <Text>{row.itemText}{row.selectedItem ? `(${row.selectedItem.model_jp || row.selectedItem.item_code})` : ''}</Text>
                {row.subLines.map((line, i) => line ? <Text key={i} style={{ fontSize: 8.5, marginTop: 1 }}>{line}</Text> : null)}
              </View>
              <View style={[S.td, { width: COL.qty, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ textAlign: 'center' }}>{row.quantity > 0 ? String(row.quantity) : ''}</Text>
              </View>
              <View style={[S.td, { width: COL.unit, justifyContent: 'center', alignItems: 'flex-end' }]}>
                <Text>{row.unit_price > 0 ? `₩  ${numKR(row.unit_price)}` : ''}</Text>
              </View>
              <View style={[S.td, { width: COL.supply, justifyContent: 'center', alignItems: 'flex-end' }]}>
                <Text>{row.supply_price > 0 ? `₩  ${numKR(row.supply_price)}` : ''}</Text>
              </View>
              <View style={[S.tdLast, { width: COL.tax, justifyContent: 'center', alignItems: 'flex-end' }]}>
                <Text style={{ paddingRight: 4 }}>{row.tax > 0 ? `₩  ${numKR(row.tax)}` : ''}</Text>
              </View>
            </View>
          ))}
          <View style={{ flexDirection: 'row', height: EMPTY_ROWS * 18 }}>
            <View style={{ width: COL.name, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.qty, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.unit, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.supply, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.tax }} />
          </View>
          <View style={S.remarkRow}>
            <View style={S.remarkContent}>
              <Text style={[S.remarkLine, { fontFamily: 'NotoSansCJK' }]}>　비고</Text>
              {remarks.split('\n').map((line, i) => <Text key={i} style={S.remarkLine}>{line}</Text>)}
              <Text style={[S.remarkLine, { marginTop: 2 }]}>* 담당자 : {engineerName}</Text>
            </View>
            <View style={{ width: COL.qty, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.unit, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.supply, borderRightWidth: THICK, borderRightColor: '#000' }} />
            <View style={{ width: COL.tax }} />
          </View>
          {[{ label: '합　　계', value: totalSupply }, { label: '부 가 세', value: totalTax }, { label: '총　　계', value: totalAmount }].map(({ label, value }) => (
            <View key={label} style={S.summaryRow}>
              <View style={[S.td, { width: COL.name, height: 22, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ fontSize: 9, fontFamily: 'NotoSansCJK' }}>{label}</Text>
              </View>
              <View style={[S.td, { width: COL.qty, height: 22 }]} />
              <View style={[S.td, { width: COL.unit, height: 22 }]} />
              <View style={[S.td, { width: COL.supply, height: 22 }]} />
              <View style={[S.tdLast, { width: COL.tax, height: 22, justifyContent: 'center' }]}>
                <Text style={{ fontSize: 9, textAlign: 'right', paddingRight: 4 }}>{value > 0 ? `₩${numKR(value)}` : ''}</Text>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}, (prev, next) => JSON.stringify(prev) === JSON.stringify(next))

type ProfitPanelProps = { rows: QuoteRow[]; exchangeRate: number; rateUpdatedAt: string; rateLoading: boolean; onFetchRate: () => void; onRateChange: (rate: number) => void }

function ProfitPanel({ rows, exchangeRate, rateUpdatedAt, rateLoading, onFetchRate, onRateChange }: ProfitPanelProps) {
  const [editingRate, setEditingRate] = useState(false)
  const [editRateVal, setEditRateVal] = useState('')

  const startEdit = () => {
    setEditRateVal(exchangeRate ? exchangeRate.toFixed(4) : '')
    setEditingRate(true)
  }
  const commitEdit = () => {
    const n = parseFloat(editRateVal)
    if (!isNaN(n) && n > 0) onRateChange(n)
    setEditingRate(false)
  }
  const totalSupply = rows.reduce((s, r) => s + r.supply_price, 0)
  const totalProduct = rows.reduce((s, r) => s + r.product_price, 0)
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0)
  const profitPct = totalSupply > 0 ? (totalProfit / totalSupply) * 100 : 0
  const isGood = profitPct >= 40
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: `1.5px solid ${isGood ? '#bbf7d0' : '#fecaca'}`, marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ background: isGood ? '#f0fdf4' : '#fef2f2', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${isGood ? '#dcfce7' : '#fee2e2'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#111113', letterSpacing: '-0.2px' }}>수익 분석</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {editingRate ? (
              <input
                type="number"
                value={editRateVal}
                onChange={e => setEditRateVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingRate(false) }}
                autoFocus
                style={{ width: 80, fontSize: 11, fontWeight: 700, color: '#234ea2', border: '1px solid #234ea2', borderRadius: 5, padding: '1px 5px', outline: 'none' }}
              />
            ) : (
              <span
                onDoubleClick={startEdit}
                title="더블클릭하여 수동 입력"
                style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, cursor: 'text', borderBottom: '1px dashed #9ca3af' }}>
                {exchangeRate ? `${exchangeRate.toFixed(4)}원` : '환율 로딩중...'}
              </span>
            )}
            {rateUpdatedAt && !editingRate && <span style={{ fontSize: 10, color: '#9ca3af' }}>({rateUpdatedAt})</span>}
            <button
              onClick={onFetchRate}
              disabled={rateLoading}
              style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', border: '1px solid #e2e4e9', cursor: rateLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s ease' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={rateLoading ? '#9ca3af' : '#374151'} strokeWidth="2.5">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, padding: '5px 14px', borderRadius: 99, background: isGood ? '#16a34a' : '#dc2626', color: '#fff', letterSpacing: '-0.1px' }}>
          {isGood ? '✓' : '!'} 이익률 {profitPct.toFixed(1)}%
        </span>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {rows.map((r, i) => r.supply_price > 0 && (
          <div key={r.id} style={{ marginBottom: 10, padding: '10px 12px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e8eaed' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#234ea2', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{r.itemText && r.itemText}{r.selectedItem && ` (${r.selectedItem.model_jp})`}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {r.selectedItem && (<>
                <div style={{ background: '#fff', borderRadius: 7, padding: '6px 9px', border: '1px solid #e8eaed' }}><div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2, fontWeight: 500 }}>구입가</div><div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>¥{r.cost_price_jpy.toLocaleString()}</div></div>
                <div style={{ background: '#fff', borderRadius: 7, padding: '6px 9px', border: '1px solid #e8eaed' }}><div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2, fontWeight: 500 }}>관세 × 환율</div><div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>×{r.tariff_rate} × {r.exchange_rate.toFixed(2)}</div></div>
                <div style={{ background: '#fff', borderRadius: 7, padding: '6px 9px', border: '1px solid #e8eaed' }}><div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2, fontWeight: 500 }}>원가</div><div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>₩{numKR(r.product_price)}</div></div>
              </>)}
              <div style={{ background: '#fff', borderRadius: 7, padding: '6px 9px', border: '1px solid #e8eaed' }}><div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2, fontWeight: 500 }}>판매단가</div><div style={{ fontSize: 12, fontWeight: 700, color: '#234ea2' }}>₩{numKR(r.unit_price)}</div></div>
              <div style={{ background: '#fff', borderRadius: 7, padding: '6px 9px', border: '1px solid #e8eaed' }}><div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2, fontWeight: 500 }}>공급가</div><div style={{ fontSize: 12, fontWeight: 700, color: '#234ea2' }}>₩{numKR(r.supply_price)}</div></div>
              <div style={{ background: r.profit >= 0 ? '#f0fdf4' : '#fef2f2', borderRadius: 7, padding: '6px 9px', border: `1px solid ${r.profit >= 0 ? '#bbf7d0' : '#fecaca'}` }}><div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2, fontWeight: 500 }}>매출이익 ({r.profit_rate}%)</div><div style={{ fontSize: 12, fontWeight: 800, color: r.profit >= 0 ? '#16a34a' : '#dc2626' }}>₩{numKR(r.profit)}</div></div>
            </div>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 4, paddingTop: 10, borderTop: '1px solid #e8eaed' }}>
          <div style={{ background: '#eff4ff', borderRadius: 10, padding: '10px 12px', border: '1px solid #c7d7f8', textAlign: 'center' }}><div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>공급가 합계</div><div style={{ fontSize: 14, fontWeight: 800, color: '#234ea2' }}>₩{numKR(totalSupply)}</div></div>
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', border: '1px solid #e8eaed', textAlign: 'center' }}><div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>원가 합계</div><div style={{ fontSize: 14, fontWeight: 800, color: '#374151' }}>₩{numKR(totalProduct)}</div></div>
          <div style={{ background: isGood ? '#f0fdf4' : '#fef2f2', borderRadius: 10, padding: '10px 12px', border: `1px solid ${isGood ? '#bbf7d0' : '#fecaca'}`, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>매출이익 합계</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: isGood ? '#16a34a' : '#dc2626' }}>₩{numKR(totalProfit)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: isGood ? '#16a34a' : '#dc2626' }}>({profitPct.toFixed(1)}%)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── debounce 훅 ───────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    let mounted = true
    const timer = setTimeout(() => {
      if (mounted) setDebounced(value)
    }, delay)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [value, delay])
  return debounced
}

export default function QuotePage() {
  const supabase = createClient()
  const [isClient, setIsClient] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  const [engineer, setEngineer] = useState<Engineer | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number>(0)
  const [rateUpdatedAt, setRateUpdatedAt] = useState('')
  const [rateLoading, setRateLoading] = useState(false)

  const [company, setCompany] = useState('')
  const [receiver, setReceiver] = useState('')
  const [titleItem, setTitleItem] = useState('')
  const [remarks, setRemarks] = useState('* 발주 진행 시 팩스 또는 메일로 발주서 회신 요망\n   (FAX : 031-786-4090)')
  const [delivery, setDelivery] = useState('')
  const [isDealer, setIsDealer] = useState(false)

  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)

  const [euCustomerId, setEuCustomerId] = useState<number | null>(null)
  const [euQuery, setEuQuery] = useState('')
  const [euResults, setEuResults] = useState<CustomerResult[]>([])
  const [euSearchOpen, setEuSearchOpen] = useState(false)
  const [selectedEU, setSelectedEU] = useState<CustomerResult | null>(null)

  const [rows, setRows] = useState<QuoteRow[]>([createRow()])
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({})
  const [searchResults, setSearchResults] = useState<Record<string, PriceItem[]>>({})
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({})
  const [priceInputOpen, setPriceInputOpen] = useState<Record<string, boolean>>({})
  const [editingProfitRate, setEditingProfitRate] = useState<Record<string, boolean>>({})
  const [profitRateInput, setProfitRateInput] = useState<Record<string, string>>({})
  const [showPriceGuide, setShowPriceGuide] = useState(false)
  const priceGuideRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showPriceGuide) return
    const handleClickOutside = (e: MouseEvent) => {
      if (priceGuideRef.current && !priceGuideRef.current.contains(e.target as Node)) {
        setShowPriceGuide(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPriceGuide])

  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = today.getMonth() + 1
  const dd = today.getDate()
  const dateStr = `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`
  const dateDisplay = `${yyyy}年　${String(mm).padStart(2, '0')}月　${String(dd).padStart(2, '0')}日`

  const [seqIndex, setSeqIndex] = useState(0)
  const seqLetter = String.fromCharCode(65 + seqIndex)

  // ── PDF용 debounced 값 (600ms 지연) ─────────────────────────────────────────
  const debouncedCompany = useDebounce(company || customerQuery, 600)
  const debouncedReceiver = useDebounce(receiver, 600)
  const debouncedTitleItem = useDebounce(titleItem, 600)
  const debouncedRows = useDebounce(rows, 600)

  const finalRemarksForPDF = (() => {
    const parts: string[] = []
    if (delivery.trim()) parts.push(`* 납기 : 발주 후 ${delivery.trim()}`)
    if (isDealer && euQuery.trim()) parts.push(`* E.U  : ${euQuery.trim()}`)
    if (remarks.trim()) parts.push(remarks.trim())
    return parts.join('\n')
  })()
  const debouncedFinalRemarks = useDebounce(finalRemarksForPDF, 600)

 useEffect(() => {
    if (!engineer) return
    const f = async () => {
      const { data } = await supabase
        .from('quote_sequence').select('seq')
        .eq('date_str', dateStr).eq('engineer_id', engineer.engineer_id)
        .order('seq', { ascending: false }).limit(1).single()
      // 오늘 마지막으로 쓴 seq+1 로 시작 (없으면 0 = A)
      setSeqIndex(data ? data.seq + 1 : 0)
    }
    f()
  }, [engineer, dateStr])

  const quoteNo = `No.${(engineer?.initials || 'KJW').toUpperCase()}${dateStr}-${seqLetter}`
  const totalSupply = rows.reduce((s, r) => s + r.supply_price, 0)
  const totalTax = rows.reduce((s, r) => s + r.tax, 0)
  const totalAmount = totalSupply + totalTax
  const totalCost = rows.reduce((s, r) => s + r.product_price, 0)
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0)
  const totalProfitRate = totalSupply > 0 ? (totalProfit / totalSupply) * 100 : 0
  const engineerName = engineer ? `${engineer.name} ${engineer.position || ''}`.trim() : ''

  // PDF용 합계 (debounced rows 기준)
  const pdfTotalSupply = debouncedRows.reduce((s, r) => s + r.supply_price, 0)
  const pdfTotalTax = debouncedRows.reduce((s, r) => s + r.tax, 0)
  const pdfTotalAmount = pdfTotalSupply + pdfTotalTax

  const handleCustomerSearch = async (q: string) => {
    setCustomerQuery(q)
    if (!q.trim()) { setCustomerResults([]); return }
    const { data } = await supabase
      .from('customers').select('customer_id, company_name, address, status')
      .is('deleted_at', null)
      .ilike('company_name', `%${q}%`).limit(10)
    setCustomerResults(data || [])
    setCustomerSearchOpen(true)
  }

  const handleCustomerSelect = (c: CustomerResult) => {
    setSelectedCustomer(c)
    setCustomerId(c.customer_id)
    setCompany(c.company_name)
    setCustomerQuery(c.company_name)
    setCustomerSearchOpen(false)
    setCustomerResults([])
  }

  const handleCustomerClear = () => {
    setSelectedCustomer(null)
    setCustomerId(null)
    setCustomerQuery('')
    setCompany('')
  }

  const handleEUSearch = async (q: string) => {
    setEuQuery(q)
    if (!q.trim()) { setEuResults([]); return }
    const { data } = await supabase
      .from('customers').select('customer_id, company_name, address, status')
      .is('deleted_at', null)
      .ilike('company_name', `%${q}%`).limit(10)
    setEuResults(data || [])
    setEuSearchOpen(true)
  }

  const handleEUSelect = (c: CustomerResult) => {
    setSelectedEU(c)
    setEuCustomerId(c.customer_id)
    setEuQuery(c.company_name)
    setEuSearchOpen(false)
    setEuResults([])
  }

  const handleEUClear = () => {
    setSelectedEU(null)
    setEuCustomerId(null)
    setEuQuery('')
  }

const handleDownloadPDF = async (
    overrideCompany?: string,
    overrideReceiver?: string,
    overrideTitleItem?: string,
    overrideRows?: QuoteRow[],
    overrideRemarks?: string,
    overrideQuoteNo?: string,
  ) => {
    const finalCompany = overrideCompany ?? (company || customerQuery)
    const finalReceiver = overrideReceiver ?? receiver
    const finalTitleItem = overrideTitleItem ?? titleItem
    const finalRows = overrideRows ?? rows
    const finalRemarks = overrideRemarks ?? finalRemarksForPDF
    const finalQuoteNo = overrideQuoteNo ?? quoteNo

    const firstItem = finalRows.find(r => r.supply_price > 0)
    const itemName = firstItem
      ? (firstItem.selectedItem?.model_jp || firstItem.itemText || '').trim()
      : ''
    const companyName = finalCompany.trim()
    const fileName = [finalQuoteNo, companyName, '견적서', itemName]
      .filter(Boolean)
      .join('_')
      .replace(/[\\/:*?"<>|]/g, '') + '.pdf'

    const finalTotalSupply = finalRows.reduce((s, r) => s + r.supply_price, 0)
    const finalTotalTax = finalRows.reduce((s, r) => s + r.tax, 0)
    const finalTotalAmount = finalTotalSupply + finalTotalTax

    const blob = await pdf(
      <QuotePDFDoc
        company={finalCompany}
        receiver={finalReceiver}
        quoteNo={finalQuoteNo}
        dateDisplay={dateDisplay}
        titleItem={finalTitleItem}
        rows={finalRows}
        remarks={finalRemarks}
        engineerName={engineerName}
        totalSupply={finalTotalSupply}
        totalTax={finalTotalTax}
        totalAmount={finalTotalAmount}
      />
    ).toBlob()

    const safeFileName = `${finalQuoteNo}.pdf`
    await supabase.storage.from('quote-pdfs').upload(safeFileName, blob, {
      contentType: 'application/pdf',
      upsert: true,
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)

    await supabase.from('download_logs').insert({
      engineer_id: engineer?.engineer_id ?? null,
      quote_id: null,
      quote_number: finalQuoteNo,
      company_name: companyName,
      action: 'download',
    })
  }

  const handleSaveQuote = async () => {
    if (!engineer) { alert('엔지니어 정보를 불러오는 중입니다.'); return }
    if (!company.trim() && !customerQuery.trim()) { alert('사명을 입력해주세요.'); return }
    if (rows.every(r => r.supply_price === 0)) { alert('품목 금액을 입력해주세요.'); return }

    setIsSaving(true)
    try {
      await supabase.from('quote_sequence').insert({
        date_str: dateStr, engineer_id: engineer.engineer_id, seq: seqIndex,
      })

      const { data: quoteData, error: quoteError } = await supabase
        .from('quotes').insert({
          quote_number: quoteNo,
          customer_id: isDealer ? euCustomerId : customerId,
          dealer_id: isDealer ? customerId : null,
          delivery_info: delivery.trim() || null,
          engineer_id: engineer.engineer_id,
          quote_date: `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
          total_supply: totalSupply,
          total_tax: totalTax,
          total_amount: totalAmount,
          total_cost: totalCost,
          total_profit: totalProfit,
          profit_rate: parseFloat(totalProfitRate.toFixed(2)),
          status: '견적중',
          recipient: receiver,
          subject: titleItem,
          note: finalRemarksForPDF,
          pdf_url: `quote-pdfs/${quoteNo}.pdf`,
        }).select().single()

      if (quoteError) throw quoteError

      const items = rows.filter(r => r.supply_price > 0).map(r => ({
        quote_id: quoteData.quote_id,
        price_list_id: r.selectedItem?.id ?? null,
        product_name: r.itemText || r.selectedItem?.model_jp || '',
        quantity: r.quantity,
        unit_price_jpy: r.selectedItem?.cost_jpy ?? null,
        unit_price_krw: r.unit_price,
        supply_amount: r.supply_price,
        tax_amount: r.tax,
        category: null,
        cost_amount: r.product_price,
        profit_amount: r.profit,
        profit_rate: r.profit_rate,
        exchange_rate: r.exchange_rate || exchangeRate,
        tariff_rate: r.tariff_rate,
      }))

      if (items.length > 0) {
        const { error: itemsError } = await supabase.from('quote_items').insert(items)
        if (itemsError) throw itemsError
      }
alert(`✅ 견적서 ${quoteNo} 확정 완료!`)
    } catch (e) {
      console.error(e)
      alert('저장 중 오류가 발생했습니다.')
    }
    setIsSaving(false)
  }

  useEffect(() => { setIsClient(true) }, [])

  useEffect(() => {
    const f = async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user?.email) return
      const { data } = await supabase.from('engineers').select('*').eq('email', u.user.email).single()
      if (data) setEngineer(data)
    }
    f()
  }, [])

  const fetchRate = useCallback(async () => {
    setRateLoading(true)
    try {
      const { data: cached } = await supabase.from('exchange_rate').select('*').order('id', { ascending: false }).limit(1).single()
      const todayStr = new Date().toISOString().slice(0, 10)

      // 오늘 날짜 캐시가 있으면 바로 사용
      if (cached && cached.updated_at === todayStr) {
        setExchangeRate(Number(cached.rate)); setRateUpdatedAt(cached.updated_at); setRateLoading(false); return
      }

      // 외부 API 호출
      try {
        const res = await fetch('/api/exchange-rate')
        const json = await res.json()
        const jpy = json.jpy
        if (jpy && jpy.deal_bas_r) {
          const rate = parseFloat(jpy.deal_bas_r.replace(',', '')) / 100
          setExchangeRate(rate); setRateUpdatedAt(todayStr)
          await supabase.from('exchange_rate').insert([{ rate, updated_at: todayStr }])
          setRateLoading(false); return
        }
      } catch { /* API 실패 시 아래 캐시 fallback 사용 */ }

      // API 실패 시 DB에 저장된 가장 최근 환율로 fallback
      if (cached && cached.rate) {
        setExchangeRate(Number(cached.rate)); setRateUpdatedAt(cached.updated_at)
      }
    } catch (e) { console.error(e) }
    setRateLoading(false)
  }, [])

  useEffect(() => { fetchRate() }, [fetchRate])
  useEffect(() => { if (!exchangeRate) return; setRows(prev => prev.map(r => calcRow(r, exchangeRate))) }, [exchangeRate])

  const handleRateChange = useCallback(async (rate: number) => {
    const todayStr = new Date().toISOString().slice(0, 10)
    setExchangeRate(rate)
    setRateUpdatedAt(todayStr)
    await supabase.from('exchange_rate').insert([{ rate, updated_at: todayStr }])
  }, [])

  const handleSearch = async (rowId: string, q: string) => {
    setSearchQuery(prev => ({ ...prev, [rowId]: q }))
    if (!q.trim()) { setSearchResults(prev => ({ ...prev, [rowId]: [] })); return }
    const { data } = await supabase.from('price_list').select('*').or(`item_code.ilike.%${q}%,model_jp.ilike.%${q}%`).limit(20)
    setSearchResults(prev => ({ ...prev, [rowId]: data || [] }))
    setSearchOpen(prev => ({ ...prev, [rowId]: true }))
  }

  const handleSelect = (rowId: string, item: PriceItem) => {
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, selectedItem: item }, exchangeRate)))
    setSearchOpen(prev => ({ ...prev, [rowId]: false }))
    setSearchQuery(prev => ({ ...prev, [rowId]: item.model_jp || item.item_code }))
    if (item.delivery_time && delivery === '') {
      setDelivery(item.delivery_time + '주')
    }
  }

  const updateRow = (rowId: string, field: keyof QuoteRow, value: any) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, [field]: value }, exchangeRate)))

  const clearItem = (rowId: string) => {
    setRows(prev => prev.map(r => r.id !== rowId ? r : calcRow({ ...r, selectedItem: null, manual_unit_price: 0 }, exchangeRate)))
    setSearchQuery(prev => ({ ...prev, [rowId]: '' }))
    setSearchResults(prev => ({ ...prev, [rowId]: [] }))
  }

  const updateSubLine = (rowId: string, idx: number, val: string) =>
    setRows(prev => prev.map(r => { if (r.id !== rowId) return r; const lines = [...r.subLines]; lines[idx] = val; return { ...r, subLines: lines } }))
  const addSubLine = (rowId: string) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, subLines: [...r.subLines, ''] }))
  const removeSubLine = (rowId: string, idx: number) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, subLines: r.subLines.filter((_, i) => i !== idx) }))

  const inp: React.CSSProperties = {
    padding: '8px 11px', border: '1.5px solid #e2e4e9', borderRadius: 9,
    fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box',
    color: '#111113', transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  }

  return (
    <div style={{ background: '#eef0f4', minHeight: '100vh', fontFamily: 'Malgun Gothic, sans-serif' }}>
      <style>{`
        .q-input:focus {
          border-color: #234ea2 !important;
          box-shadow: 0 0 0 3px rgba(35,78,162,0.10) !important;
          outline: none;
        }
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: 20, display: 'flex', gap: 20 }}>

        <div style={{ width: 430, flexShrink: 0 }}>

          {/* 기본 정보 */}
          <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: '1px solid #e2e4e9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 3, height: 14, background: '#234ea2', borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: 13, color: '#111113', letterSpacing: '-0.2px' }}>기본 정보</span>
            </div>

            {/* 사명 + 대리점 체크박스 */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>사명</span>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="q-input"
                    value={customerQuery}
                    onChange={e => handleCustomerSearch(e.target.value)}
                    onFocus={() => customerResults.length > 0 && setCustomerSearchOpen(true)}
                    placeholder="업체명 검색 또는 직접 입력"
                    style={{ ...inp, width: '100%', paddingRight: selectedCustomer ? 32 : 11, border: customerSearchOpen ? '1.5px solid #234ea2' : '1.5px solid #e2e4e9' }}
                  />
                  {selectedCustomer && (
                    <button onClick={handleCustomerClear}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                  {customerSearchOpen && customerResults.length > 0 && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000, background: '#fff', border: '1.5px solid #234ea2', borderRadius: 10, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
                      {customerResults.map(c => (
                        <div key={c.customer_id} onClick={() => handleCustomerSelect(c)}
                          style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 12, transition: 'background 0.12s ease' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                          <div style={{ fontWeight: 700, color: '#234ea2' }}>{c.company_name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={isDealer}
                    onChange={e => {
                      setIsDealer(e.target.checked)
                      if (!e.target.checked) { handleEUClear() }
                    }}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#234ea2' }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: isDealer ? '#234ea2' : '#6b7280' }}>대리점</span>
                </label>
              </div>
              {selectedCustomer && (
                <div style={{ marginTop: 4, marginLeft: 64, padding: '3px 8px', background: isDealer ? '#fff7ed' : '#eff4ff', borderRadius: 6, fontSize: 11, color: isDealer ? '#c2410c' : '#234ea2', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  {selectedCustomer.company_name} {isDealer ? '(대리점)' : '연결됨'}
                </div>
              )}
              {!selectedCustomer && customerQuery && (
                <div style={{ marginTop: 2, marginLeft: 64, fontSize: 11, color: '#9ca3af' }}>검색 결과 없으면 그대로 사용됩니다</div>
              )}
            </div>

            {/* E.U 필드 (대리점 체크 시 표시) */}
            {isDealer && (
              <div style={{ marginBottom: 8, animation: 'modal-in 0.15s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>E.U</span>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      className="q-input"
                      value={euQuery}
                      onChange={e => handleEUSearch(e.target.value)}
                      onFocus={() => euResults.length > 0 && setEuSearchOpen(true)}
                      placeholder="최종 사용 업체 검색 또는 직접 입력"
                      style={{ ...inp, width: '100%', paddingRight: selectedEU ? 32 : 11, border: euSearchOpen ? '1.5px solid #c2410c' : '1.5px solid #fed7aa' }}
                    />
                    {selectedEU && (
                      <button onClick={handleEUClear}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                    {euSearchOpen && euResults.length > 0 && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000, background: '#fff', border: '1.5px solid #c2410c', borderRadius: 10, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(194,65,12,0.12)' }}>
                        {euResults.map(c => (
                          <div key={c.customer_id} onClick={() => handleEUSelect(c)}
                            style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 12, transition: 'background 0.12s ease' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#fff7ed')}
                            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                            <div style={{ fontWeight: 700, color: '#c2410c' }}>{c.company_name}</div>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{c.address ?? ''}{c.status ? ` · ${c.status}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {selectedEU && (
                  <div style={{ marginTop: 4, marginLeft: 64, padding: '3px 8px', background: '#fff7ed', borderRadius: 6, fontSize: 11, color: '#c2410c', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    {selectedEU.company_name} 연결됨 (거래이력 연동)
                  </div>
                )}
                {!selectedEU && euQuery && (
                  <div style={{ marginTop: 2, marginLeft: 64, fontSize: 11, color: '#9ca3af' }}>검색 결과 없으면 그대로 사용됩니다</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>수신인</span>
              <input className="q-input" value={receiver} onChange={e => setReceiver(e.target.value)} placeholder="예: 홍길동 부장님" style={{ ...inp, flex: 1 }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>견적 내용</span>
              <input className="q-input" value={titleItem} onChange={e => setTitleItem(e.target.value)} placeholder="예: 측정기 부품 견적의 건" style={{ ...inp, flex: 1 }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap', width: 56, flexShrink: 0 }}>납기</span>
              <input
                className="q-input"
                value={delivery}
                onChange={e => setDelivery(e.target.value)}
                placeholder="품목 선택 후 납기 정보가 없을 시 입력"
                style={{ ...inp, flex: 1 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4, display: 'block' }}>비고</label>
              <textarea className="q-input" value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
                style={{ ...inp, width: '100%', resize: 'vertical', lineHeight: 1.7 }} />
            </div>
          </div>

       <div style={{ position: 'relative', overflow: 'hidden' }}>
            {[-1, 0, 1, 2].map(i => (
              <div key={i} style={{ position: 'absolute', top: `${i * 140 + 60}px`, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 10, transform: 'rotate(-20deg)', opacity: 0.05 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>{engineerName}</span>
              </div>
            ))}
            <ProfitPanel rows={rows} exchangeRate={exchangeRate} rateUpdatedAt={rateUpdatedAt} rateLoading={rateLoading} onFetchRate={fetchRate} onRateChange={handleRateChange} />
          </div>

          {/* 품목 */}
          <div onClick={() => showPriceGuide && setShowPriceGuide(false)} style={{ background: '#fff', borderRadius: 14, padding: '20px 20px', border: '1px solid #e2e4e9', position: 'relative' }}>
            {/* 워터마크 — 자체 overflow:hidden 컨테이너로 분리하여 팝업이 잘리지 않도록 */}
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 10, borderRadius: 14 }}>
              {Array.from({ length: 20 }, (_, i) => i).map(i => (
                <div key={i} style={{ position: 'absolute', top: `${i * 140}px`, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(-20deg)', opacity: 0.05 }}>
                  <span style={{ fontSize: 42, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>{engineerName}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 3, height: 16, background: '#234ea2', borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: 14, color: '#111113', letterSpacing: '-0.2px' }}>품목</span>
              {rows.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#eff4ff', color: '#234ea2' }}>{rows.length}</span>
              )}
              {/* 마진/정도검사 가이드 버튼 — 오른쪽 끝 */}
              <div ref={priceGuideRef} style={{ marginLeft: 'auto', position: 'relative' }}>
                <button
                  onClick={() => setShowPriceGuide(p => !p)}
                  title="마진 및 정도검사 가격 안내"
                  style={{ width: 20, height: 20, borderRadius: '50%', background: showPriceGuide ? '#234ea2' : '#e8edf5', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, color: showPriceGuide ? '#fff' : '#234ea2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}
                >!</button>
                {/* 팝업 — 버튼 오른쪽, 세로 중앙 정렬 */}
                {showPriceGuide && (
                  <div
                    style={{ position: 'absolute', left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)', zIndex: 300, background: '#fff', borderRadius: 14, border: '1px solid #e2e4e9', boxShadow: '0 12px 36px rgba(0,0,0,0.16)', width: 340, padding: '16px 18px', maxHeight: '70vh', overflowY: 'auto' }}
                  >
                  {/* 닫기 */}
                  <button onClick={() => setShowPriceGuide(false)} style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#f4f5f7', cursor: 'pointer', fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

                  {/* 섹션1: 견적서 마진 */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#1e3a6e', borderRadius: 7, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>견적서 제출 마진</div>
                    {[
                      { label: '대리점 및 기존 고객사 (스타일러스)', value: '40%' },
                      { label: '신규고객사 (스타일러스)', value: '50%' },
                      { label: '장비 업그레이드 / 일본가격문의', value: '60%' },
                    ].map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 6px', borderRadius: 6, background: i % 2 === 0 ? '#f8fafc' : '#fff', marginBottom: 2 }}>
                        <span style={{ fontSize: 11, color: '#374151' }}>{item.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#234ea2', flexShrink: 0, marginLeft: 8 }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ height: 1, background: '#e2e4e9', marginBottom: 14 }} />

                  {/* 섹션2: 정도검사 */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#1e3a6e', borderRadius: 7, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>측정기 정도 검사</div>
                    {[
                      { cat: '83', items: [{ label: '조도', price: '600,000' }, { label: '형상', price: '800,000' }, { label: '조도형상', price: '1,000,000' }] },
                      { cat: '84', items: [{ label: '소형 43C', price: '800,000' }, { label: '중형 R-NEX200', price: '1,000,000' }, { label: 'R55/R60', price: '1,200,000' }, { label: 'R73A', price: '4,000,000' }] },
                      { cat: '81', items: [{ label: 'CMM', price: '3,500,000' }] },
                    ].map((group, gi) => (
                      <div key={gi} style={{ display: 'flex', marginBottom: gi < 2 ? 6 : 0 }}>
                        <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#234ea2', borderRadius: 5, padding: '1px 5px' }}>{group.cat}</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          {group.items.map((item, ii) => (
                            <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', borderRadius: 5, background: ii % 2 === 0 ? '#f8fafc' : '#fff', marginBottom: 2 }}>
                              <span style={{ fontSize: 11, color: '#374151' }}>{item.label}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#111113' }}>₩{item.price}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>

            {rows.map((row, rowIdx) => (
              <div key={row.id} style={{ background: '#f8fafc', borderRadius: 12, padding: '14px', marginBottom: 10, border: '1px solid #e2e4e9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#234ea2', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{rowIdx + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111113' }}>품목</span>
                  </div>
                  <button onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                    style={{ padding: '2px 0', background: 'none', color: '#dc2626', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>삭제</button>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, display: 'block' }}>품명</label>
                  <input className="q-input" value={row.itemText} onChange={e => updateRow(row.id, 'itemText', e.target.value)} placeholder="예: 1. 스타일러스" style={{ ...inp, width: '100%' }} />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, display: 'block' }}>
                    상품 검색{row.selectedItem && <span style={{ color: '#16a34a', marginLeft: 6, fontWeight: 700 }}>✓ 선택됨</span>}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input className="q-input" value={searchQuery[row.id] || ''} onChange={e => handleSearch(row.id, e.target.value)}
                      onFocus={() => setSearchOpen(prev => ({ ...prev, [row.id]: true }))}
                      placeholder="코드 또는 모델명 검색" style={{ ...inp, width: '100%' }} />
                    {searchOpen[row.id] && (searchResults[row.id] || []).length > 0 && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999, background: '#fff', border: '1.5px solid #234ea2', borderRadius: 10, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 24px rgba(35,78,162,0.12)' }}>
                        {searchResults[row.id].map(item => (
                          <div key={item.id} onClick={() => handleSelect(row.id, item)}
                            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 11, transition: 'background 0.12s ease' }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                            onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                            <div><span style={{ fontWeight: 700, color: '#234ea2' }}>{item.item_code}</span><span style={{ marginLeft: 6, color: '#374151' }}>{item.item_name_jp}</span><span style={{ marginLeft: 6, color: '#6b7280' }}>({item.model_jp})</span></div>
                            <div style={{ color: '#9ca3af', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>정가: ¥{item.price_jpy?.toLocaleString()} / 구입가: ¥{item.cost_jpy?.toLocaleString()}</span>
                              {(() => {
                                const hasStock = item.stock_quantity != null && item.stock_quantity > 0
                                const hasDelivery = item.delivery_time != null
                                if (hasStock) return (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#dcfce7', color: '#15803d' }}>
                                    재고 {item.stock_quantity}개
                                  </span>
                                )
                                if (hasDelivery) return (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#fef9c3', color: '#854d0e' }}>
                                    발주 후 {item.delivery_time}주
                                  </span>
                                )
                                return (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#fee2e2', color: '#b91c1c' }}>
                                    담당자 납기 문의
                                  </span>
                                )
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {row.selectedItem && (
                    <button onClick={() => clearItem(row.id)}
                      style={{ marginTop: 6, padding: '3px 10px', background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>품목 해제</button>
                  )}
                </div>

                {/* 스테퍼 — 통합 컨테이너 */}
                <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e4e9', display: 'flex', marginBottom: !row.selectedItem && priceInputOpen[row.id] ? 0 : 10, overflow: 'hidden' }}>
                  <div style={{ flex: 1, padding: '5px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2, fontWeight: 600 }}>수량</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                      <button onClick={() => updateRow(row.id, 'quantity', Math.max(1, row.quantity - 1))} style={{ width: 20, height: 20, border: '1px solid #e2e4e9', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>−</button>
                      <span style={{ minWidth: 26, textAlign: 'center', fontWeight: 800, fontSize: 13, color: '#111113' }}>{row.quantity}</span>
                      <button onClick={() => updateRow(row.id, 'quantity', row.quantity + 1)} style={{ width: 20, height: 20, border: '1px solid #e2e4e9', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>+</button>
                    </div>
                  </div>
                  <div style={{ width: 1, background: '#e2e4e9', flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: '5px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2, fontWeight: 600 }}>이익률</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                      <button onClick={() => updateRow(row.id, 'profit_rate', Math.max(0, row.profit_rate - 5))} style={{ width: 20, height: 20, border: '1px solid #e2e4e9', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>−</button>
                      {editingProfitRate[row.id] ? (
                        <input
                          autoFocus
                          type="number"
                          value={profitRateInput[row.id] ?? ''}
                          onChange={e => setProfitRateInput(p => ({ ...p, [row.id]: e.target.value }))}
                          onBlur={() => {
                            const v = Math.min(95, Math.max(0, parseInt(profitRateInput[row.id] || '0') || 0))
                            updateRow(row.id, 'profit_rate', v)
                            setEditingProfitRate(p => ({ ...p, [row.id]: false }))
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                          }}
                          style={{ width: 40, textAlign: 'center', fontWeight: 800, fontSize: 12, border: '1px solid #234ea2', borderRadius: 4, padding: '1px 2px', outline: 'none', color: '#111113' }}
                        />
                      ) : (
                        <span
                          onClick={() => { setEditingProfitRate(p => ({ ...p, [row.id]: true })); setProfitRateInput(p => ({ ...p, [row.id]: String(row.profit_rate) })) }}
                          title="클릭하여 직접 입력"
                          style={{ minWidth: 36, textAlign: 'center', fontWeight: 800, fontSize: 13, color: row.profit_rate >= 40 ? '#16a34a' : '#dc2626', cursor: 'text' }}
                        >{row.profit_rate}%</span>
                      )}
                      <button onClick={() => updateRow(row.id, 'profit_rate', Math.min(95, row.profit_rate + 5))} style={{ width: 20, height: 20, border: '1px solid #e2e4e9', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>+</button>
                    </div>
                  </div>
                  <div style={{ width: 1, background: '#e2e4e9', flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: '5px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2, fontWeight: 600 }}>관세율</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                      <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate - 0.01).toFixed(2)))} style={{ width: 20, height: 20, border: '1px solid #e2e4e9', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>−</button>
                      <span style={{ minWidth: 36, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#374151' }}>×{row.tariff_rate.toFixed(2)}</span>
                      <button onClick={() => updateRow(row.id, 'tariff_rate', parseFloat((row.tariff_rate + 0.01).toFixed(2)))} style={{ width: 20, height: 20, border: '1px solid #e2e4e9', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>+</button>
                    </div>
                  </div>
                  {!row.selectedItem && (
                    <>
                      <div style={{ width: 1, background: '#e2e4e9', flexShrink: 0 }} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 10px' }}>
                        <button
                          onClick={() => setPriceInputOpen(p => ({ ...p, [row.id]: !p[row.id] }))}
                          style={{ padding: '4px 10px', background: priceInputOpen[row.id] ? '#234ea2' : '#eff4ff', color: priceInputOpen[row.id] ? '#fff' : '#234ea2', border: '1px solid #c7d7f8', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.15s ease' }}
                        >₩ 단가</button>
                      </div>
                    </>
                  )}
                </div>
                {!row.selectedItem && priceInputOpen[row.id] && (
                  <div style={{ background: '#fff', border: '1px solid #e2e4e9', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '8px 10px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>단가 직접입력</span>
                    <input className="q-input" autoFocus type="number" value={row.manual_unit_price || ''}
                      onChange={e => updateRow(row.id, 'manual_unit_price', parseInt(e.target.value) || 0)}
                      placeholder="0" style={{ ...inp, flex: 1, textAlign: 'right', fontSize: 13 }} />
                    <span style={{ fontSize: 11, color: '#6b7280' }}>원</span>
                  </div>
                )}

                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, display: 'block' }}>세부항목</label>
                  {row.subLines.map((line, li) => (
                    <div key={li} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input className="q-input" value={line} onChange={e => updateSubLine(row.id, li, e.target.value)} placeholder="예: - Leaf Spring 교체" style={{ ...inp, flex: 1, fontSize: 11 }} />
                      <button onClick={() => removeSubLine(row.id, li)} style={{ padding: '0 9px', background: 'none', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 7, cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center' }}>−</button>
                    </div>
                  ))}
                  <button onClick={() => addSubLine(row.id)} style={{ padding: '4px 12px', background: '#eff4ff', color: '#234ea2', border: '1px solid #c7d7f8', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>+ 세부항목 추가</button>
                </div>

                {row.supply_price > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 11, color: '#166534', borderLeft: '3px solid #16a34a' }}>
                    단가 ₩{numKR(row.unit_price)} × {row.quantity} = 공급가 <b>₩{numKR(row.supply_price)}</b> | 부가세 ₩{numKR(row.tax)}
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={() => setRows(prev => [...prev, createRow()])}
              style={{ width: '100%', padding: '11px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background 0.15s ease' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1c3e87')}
              onMouseLeave={e => (e.currentTarget.style.background = '#234ea2')}
            >
              + 품목 추가
            </button>
          </div>
        </div>

        {/* PDF 미리보기 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: '#f4f5f7', borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e4e9', height: 'calc(100vh - 40px)', position: 'sticky', top: 20 }}>

            {/* 헤더 */}
            <div style={{ background: 'linear-gradient(135deg, #1c3e87 0%, #234ea2 100%)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 500, marginBottom: 2 }}>견적 번호</div>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 800, letterSpacing: '-0.2px' }}>{quoteNo}</div>
              </div>
              <button
                onClick={() => setShowConfirmModal(true)}
                disabled={isSaving}
                style={{
                  padding: '8px 20px', background: isSaving ? 'rgba(255,255,255,0.15)' : '#16a34a', color: '#fff',
                  border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'background 0.15s ease',
                }}>
                {!isSaving && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
                {isSaving ? '저장 중...' : '견적 확정'}
              </button>
            </div>

            {/* PDF — debounced 값 사용으로 깜빡임 방지 */}
            {isClient && (
              <PDFViewer width="100%" height="100%" showToolbar={false} style={{ border: 'none' }}>
                <QuotePDFDoc
                  company={debouncedCompany}
                  receiver={debouncedReceiver}
                  quoteNo={quoteNo}
                  dateDisplay={dateDisplay}
                  titleItem={debouncedTitleItem}
                  rows={debouncedRows}
                  remarks={debouncedFinalRemarks}
                  engineerName={engineerName}
                  totalSupply={pdfTotalSupply}
                  totalTax={pdfTotalTax}
                  totalAmount={pdfTotalAmount}
                  showWatermark={true}
                />
              </PDFViewer>
            )}
          </div>
        </div>
      </div>

      {/* 견적 확정 확인 모달 */}
      {showConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111113', marginBottom: 4, letterSpacing: '-0.3px' }}>견적 확정</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>{quoteNo}</div>
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.8 }}>
                견적 확정 시 실적으로 기록되며, <b>관리자의 승인 없이는 삭제가 불가능합니다.</b>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
              <div style={{ background: '#eff4ff', borderRadius: 10, padding: '12px 14px', border: '1px solid #c7d7f8', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>공급가</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#234ea2' }}>₩{numKR(totalSupply)}</div>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', border: '1px solid #e8eaed', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>원가</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#374151' }}>₩{numKR(totalCost)}</div>
              </div>
              <div style={{ background: totalProfitRate >= 40 ? '#f0fdf4' : '#fef2f2', borderRadius: 10, padding: '12px 14px', border: `1px solid ${totalProfitRate >= 40 ? '#bbf7d0' : '#fecaca'}`, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>순이익</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: totalProfitRate >= 40 ? '#16a34a' : '#dc2626' }}>
                  ₩{numKR(totalProfit)}<br />
                  <span style={{ fontSize: 11 }}>({totalProfitRate.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConfirmModal(false)}
                style={{ flex: 1, padding: '12px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', color: '#374151' }}>
                취소
              </button>
              <button onClick={async () => {
                setShowConfirmModal(false)
                const snapshotCompany = company || customerQuery
                const snapshotReceiver = receiver
                const snapshotTitleItem = titleItem
                const snapshotRows = [...rows]
                const snapshotRemarks = finalRemarksForPDF
                const snapshotQuoteNo = quoteNo
                await handleSaveQuote()
                await handleDownloadPDF(snapshotCompany, snapshotReceiver, snapshotTitleItem, snapshotRows, snapshotRemarks, snapshotQuoteNo)
                setSeqIndex(prev => prev + 1)
              }}
                style={{ flex: 1, padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
