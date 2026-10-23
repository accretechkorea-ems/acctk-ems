# 검사 — 무엇이 자동으로 돌고, 무엇을 손으로 돌리는가

```
npm run check     세 가지를 한 번에(아래 CI 와 같은 명령이다)
npx tsc --noEmit  타입 — 0건이어야 한다
npm run lint:ci   경고 수를 기준선과 견준다(lint-baseline.json)
npm test          하네스 전부(scripts/*-check.js)
npm test quote    이름에 'quote' 가 든 하네스만
```

`push`(master)와 모든 PR 에서 **GitHub Actions 가 같은 세 단계를 돈다** —
`.github/workflows/check.yml`. 로컬에서 `npm run check` 가 통과하면 CI 도 통과한다.

## 경고 기준선

지금 경고는 **140건**이고 `lint-baseline.json` 의 `maxWarnings` 가 그 수를 들고 있다.
넘으면 CI 가 막는다. **경고를 줄였으면 `lint-baseline.json` 의 `maxWarnings` 를 같이 내린다**
— 내리지 않으면 다시 늘어나도 아무도 모른다(`npm run lint:ci` 가 줄었을 때 그 사실과 새 숫자를
알려 준다). 올리는 일은 없어야 한다. 올리고 싶으면 그 경고를 먼저 보라.

오류(`maxErrors`)는 0 이다 — 하나라도 생기면 어디인지 찍고 막는다.

경고 내역과 「고칠 가치 vs 끄고 말 것」 판단은 `docs/audit-2026-10.md` A4 에 있다.

## 하네스

`scripts/*-check.js` 를 `scripts/run-checks.js` 가 **이름순으로** 돌린다. 목록은 어디에도
적지 않는다 — 파일을 두면 그다음 실행에 들어온다. 하나라도 실패하면 **끝까지 돌린 뒤**
종료 코드 1 로 끝낸다(한 번에 다 보이게).

**이름이 곧 약속이다.** `-check.js` 로 끝나는 파일은 **Supabase 키 없이 도는 순수 함수
시험**이어야 한다. scripts/ 에 있는 다른 것들은 그렇지 않다 —

| 파일 | 왜 하네스가 아닌가 |
|---|---|
| `scripts/perf/measure.ts` · `login.ts` | 운영 DB·Auth 에 붙는다(측정 도구) |
| `scripts/reset-passwords.js` | 비밀번호를 바꾼다 |
| `scripts/gen-service-report-template.js` | 파일을 만든다 |
| `scripts/lint-baseline.js` | eslint 를 돌린다(그래서 `-check.js` 가 아니다) |

CI 가 키 없이 도는 것은 이 선 덕분이다. 하네스가 아닌 도구에 `-check.js` 를 붙이지 마라.

## CI 에 없는 것

- `next build` — Vercel 이 이미 한다(여기서 또 하면 같은 2분을 두 번 쓴다).
- 브라우저 측정(`npm run perf`) — 운영 DB 에 붙고 자격이 필요하다. 사람이 필요할 때만 돈다
  (`docs/perf/README.md`).
