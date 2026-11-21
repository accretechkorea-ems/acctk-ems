# 색상 토큰 정렬 — 2026-11-21

> 앞선 조사: `docs/color-audit-20261121.md`(보고만). 이 문서는 **그 다음 걸음**이다.
> ① 토큰 네 개를 표 값으로 고쳤다(했다). ② 직접 표기를 `var(--토큰)` 으로 옮기는 일은
> **멈췄다** — 아래 ③에 멈춘 이유와 숫자를 적었다.

## ① 토큰 네 개 — 표 값으로 고쳤다

정본은 화면이다(`.claude/rules/design-system.md` 의 색상 표). 토큰은 처음에 「전수
조사의 최다 빈도값」으로 넣었고, 그 방식이 네 자리에서 표와 다른 값을 골랐다.

| 역할 | 표(정본) | 토큰(옛) | 토큰(지금) | 그 토큰을 `var()` 로 쓰는 자리 |
|---|---|---|---|---|
| 페이지 배경 | `#fafafa` | `#f4f5f7` | `#fafafa` | **0건** |
| 테두리 | `#ebebeb` | `#e2e4e9` | `#ebebeb` | **0건** |
| 본문 진함 | `#111827` | `#111113` | `#111827` | **0건** |
| 위험 | `#ef4444` | `#dc2626` | `#ef4444` | **0건** |

네 개 모두 **0건**이라 고쳐도 화면이 바뀌는 자리가 없다(지시대로 먼저 세었다 — 0건이
아니면 그 토큰은 멈추기로 했다). 사실 프로젝트 안에서 `var(--color-*)` 를 쓰는 자리는
**하나도 없다** — 토큰은 아직 정의만 되어 있다.

하네스: `scripts/color-token-check.js` 가 표를 읽어 토큰 12자리와 맞춰 본다.
표를 고치면 토큰도 고쳐야 하고, 반대도 같다.

### 고친 뒤 토큰 밖으로 나간 값

옛 토큰 값들은 이제 어느 토큰과도 같지 않다. **건드리지 않았다**(지시대로).

| 값 | 건수 | 쓰이는 뜻 |
|---|---|---|
| `#dc2626` | 60 | 붉은 글자·확인 버튼 hover. 표에 없는 값이다 |
| `#f4f5f7` | 21 | 회색 배경(표의 페이지 배경 `#fafafa` 와 다른 색) |
| `#111113` | 15 | 검정에 가까운 글자 |
| `#e2e4e9` | 6 | 회색 테두리 |

## ② 직접 표기 — 토큰과 **같은 값**을 손으로 적은 자리

고친 뒤 기준으로 다시 세었다: **1,895건 · 148파일**(react-pdf 파일은 셈에서 뺐다).

| 값 | 토큰 | 건수 |
|---|---|---|
| `#9ca3af` | `--color-text-muted` | 282 |
| `#ebebeb` | `--color-border` | 247 |
| `#6b7280` | `--color-text-secondary` | 233 |
| `#234ea2` | `--color-brand` | 216 |
| `#111827` | `--color-ink` | 203 |
| `#ffffff` | `--color-surface` · `--color-white` | 155 |
| `#d1d5db` | `--color-border-strong` | 96 |
| `#f8fafc` | `--color-bg-subtle` | 65 |
| `#fafafa` | `--color-bg` | 54 |
| `#15803d` | `--color-success-strong` | 47 |
| `#eff4ff` | `--color-brand-tint` | 43 |
| `#16a34a` | `--color-success` | 40 |
| `#ef4444` | `--color-danger` | 39 |
| `#fef2f2` | `--color-danger-tint` | 36 |
| `#c7d7f8` | `--color-brand-border` | 36 |
| `#f0fdf4` | `--color-success-tint` | 24 |
| `#1c3e87` | `--color-brand-dark` | 21 |
| `#f59e0b` | `--color-warning-strong` | 16 |
| `#bbf7d0` | `--color-success-border` | 12 |
| `#fecaca` | `--color-danger-border` | 11 |
| `#fffbeb` | `--color-warning-tint` | 11 |
| `#d97706` | `--color-warning` | 8 |
| `#fde68a` | `--color-warning-border` | 7 |
| `#f0f0f0` | `--color-border-subtle` | 5 |

짧은 표기 `#fff` 383건은 위 셈에 **없다**(`#ffffff` 와 같은 색이지만 글자가 다르다).
옮길 때 함께 봐야 하는 자리다.

## ③ 기계 치환을 멈춘 이유

조건은 「외관 변화 0」이었다. 1,895건이 적힌 **문맥**을 세어 보면, 기계로 한 번에
바꿀 수 있는 자리와 바꾸면 **조용히 깨지는** 자리가 섞여 있다.

| 문맥 | 건수 | `var()` 가 듣는가 |
|---|---|---|
| 스타일 객체의 CSS 칸 값 (`background: '#fff'`) | 775 | 든다 |
| 문맥을 가리기 어려운 줄 (삼항·`el.style.x =`·**주석 43건**) | 543 | 줄마다 다르다 |
| 모듈 상수 (`const BORDER = '#ebebeb'`) | 253 | **그 상수를 어디에 쓰는지에 달렸다** |
| 스타일 객체의 **CSS 아닌 칸** (`bg:`·`text:`·상태 이름 키) | 184 | 쓰는 쪽에 달렸다 |
| JSX 속성·`el.style.x =` 꼴 | 79 | 그 중 **SVG 속성 13건은 듣지 않는다** |
| 글자 조립 (`` `1px solid #ebebeb` ``) | 49 | 대개 든다 |
| CSS 파일 | 26 | 든다 |

`var()` 가 **듣지 않는** 자리:

- **SVG 표현 속성** 13건 — `stroke="#9ca3af"` 같은 자리. 속성은 CSS 변수를 풀지 않는다
  (`style={{ stroke: 'var(…)' }}` 로 바꿔야 한다 — 글자만 바꾸는 치환이 아니다).
- **캔버스** 31건 — `ctx.fillStyle = '#ffffff'`(`lib/leadCardImage.ts` ·
  `app/suggestions/page.tsx` · `components/customer/modals/SignModal.tsx`).
  2D 문맥은 CSS 변수를 모른다.
- **메일 HTML** 33건 — `lib/leadMail.ts`. 메일 프로그램은 CSS 변수를 지원하지 않는다.
- **PDF(react-pdf)** — 셈에서 빼 두었다. 그쪽 스타일 엔진에 변수가 없다.
- **지도 마커 CSS 문자열** — `MapView.tsx` 의 `style.cssText = '…background:#234ea2…'`.
  이것은 사실 **듣는다**(문서 안의 요소다). 지시의 예외 목록에 있어 손대지 않았다.
- **주석** 43건 — 바꾸면 글이 깨진다. 손댈 자리가 아니다.

그리고 「픽셀 비교로 차 0」은 **화면 여섯 곳**을 본다. 위에서 깨지는 자리들(PDF·메일·
캔버스·지도 마커·아이콘 SVG)은 그 여섯 화면에 나오지 않는다 — 통과해도 안 깨졌다는
근거가 되지 못한다.

### 다음에 할 때의 순서 (제안)

1. **상수부터**: 148파일 중 색 상수를 쓰는 파일에서 `const BORDER = '#ebebeb'` 를
   `'var(--color-border)'` 로 바꾼다. 다만 그 상수가 SVG 속성(`stroke={MUTED}`)·캔버스에
   들어가는지 파일마다 먼저 본다. 상수 하나를 고치면 그 파일의 여러 자리가 함께 옮겨진다.
2. **SVG 속성을 먼저 style 로**: `stroke="#9ca3af"` → `style={{ stroke: … }}` (13건).
   그래야 1번이 안전해진다.
3. **예외를 못으로 박는다**: 메일·캔버스·PDF 파일은 치환 대상에서 빼는 목록을
   하네스에 적는다(지금 `color-token-check.js` 는 react-pdf 만 뺀다).
4. 화면 여섯 곳 픽셀 비교 **＋** 메일 HTML 글자 비교 · PDF 샘플 렌더 비교
   (`scripts/render-quote-samples.mjs`) · 지도 마커 갈무리를 함께 본다.
