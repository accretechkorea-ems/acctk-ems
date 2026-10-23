# 성능 측정 도구 — 쓰는 법

```
# ① 운영과 같은 1회 실행으로 재기(기본, 권장)
NEXT_DIST_DIR=.next-perf npx next build        # 개발 서버의 .next 와 섞이지 않는다
NEXT_DIST_DIR=.next-perf npx next start -p 3100
npm run perf

# ② 개발 서버로 재기(숫자가 부풀어 보인다 — Strict Mode 가 effect 를 두 번 돌린다)
npm run perf:dev
```

빌드가 tsconfig.json 에 줄을 더하므로 측정 뒤 `git checkout tsconfig.json` 을 한다.

- 도구: `scripts/perf/measure.ts`(실행) · `scripts/perf/screens.ts`(화면·모달 목록)
- 결과: `docs/perf/latest.md`(사람이 읽는 표) · `docs/perf/<날짜-시각>.json`(원자료)
- 기준선: `docs/perf/baseline-browser.md` — 화면별 작업의 전후 비교 기준

## 규칙 — 읽기 전용

`screens.ts` 에 적을 수 있는 걸음은 **네 가지뿐**이다: 주소 이동 · 보이는 글자 누르기 ·
선택자로 첫 줄 누르기 · ESC. 글자를 넣는 걸음은 없다(로그인 두 칸만 measure.ts 안에 있다).
글자로 누를 때는 금지어(저장·등록·삭제·확정·승인·반려·상신·제출·업로드·발주·요청…)가 한 번 더
막는다. 모달은 **열고 ESC 로 닫기만** 한다 — 모달 안을 누르는 걸음은 목록에 적을 수 없다.

계정은 `.env.local` 의 `E2E_EMAIL` / `E2E_PASSWORD` 다. 값은 로그·JSON·보고서 어디에도
남지 않는다(요청 URL 도 파라미터 **이름**만 적는다).

운영 Supabase 에 붙어 돌아간다 — 화면마다 한 번만 열고, 하루에 몇 번씩 돌릴 도구가 아니다.

## 화면·모달을 더하려면

`scripts/perf/screens.ts` 의 `SCREENS` 에 한 줄을 더한다. 모달은 `modals` 에
`{ label, open: [{ kind:'clickText', text:'…' }], expect:'열렸을 때 보이는 글자' }` 로 적는다.
열리지 않으면 보고서에 그 사실이 남는다(숫자를 만들어 넣지 않는다).

## 로그인 직후 첫 로딩만 재기

```
npm run perf -- --login
```

화면 목록은 돌지 않고 **로그인 흐름**만 구간별로 잰다 — 찬 캐시(새 컨텍스트) 3회와
더운 캐시(쿠키만 버린 같은 컨텍스트) 3회. 「로그인」을 누른 순간을 0 으로 두고
① auth 토큰 ② 리다이렉트 ③ 문서·JS ④ 본인 확인 사슬(auth/user → engineers → teams)
⑤ 카드 조회 시작 ⑥ 첫 그림·껍데기·조용해짐 을 적는다.

- 도구: `scripts/perf/login.ts`
- 결과: `docs/perf/login-flow.md` · 원자료 `docs/perf/<날짜-시각>-login.json`
- 전후 비교(2026-10-23 작업): `docs/perf/login-flow-fix.md`

요청 순서 표의 「대기」 칸이 사슬을 드러낸다 — 앞 요청이 끝난 뒤에야 시작한 요청이다.
