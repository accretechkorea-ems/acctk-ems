This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## 이 저장소에서 (ACCRETECH KOREA EMS)

| 하려는 일 | 읽을 것 |
|---|---|
| 검사 돌리기(타입·경고·하네스) | [docs/checks.md](docs/checks.md) — `npm run check` |
| 백업 받기 | `npm run backup` · 복구는 [docs/복구절차.md](docs/복구절차.md) |
| **SQL 을 DB 에 돌리기** | **[db/APPLIED.md](db/APPLIED.md)** — 돌린 뒤 **한 줄 적는다** |
| 성능 측정 | [docs/perf/README.md](docs/perf/README.md) · 규칙 [docs/perf-rules.md](docs/perf-rules.md) |
| 코드 구조·운영 현황 | [docs/audit-2026-10.md](docs/audit-2026-10.md) |
| 화면 디자인 값 | [.claude/rules/design-system.md](.claude/rules/design-system.md) |

### SQL 규칙 한 줄

**SQL 을 DB 에 돌렸으면 `db/APPLIED.md` 에 한 줄 적는다** — 파일·날짜·이름·무엇으로 확인했는지.
파일 머리말도 함께 고친다. 적지 않으면 다음 사람이 머리말만 보고 추측하게 되고,
그 머리말은 이미 한 번 7건이 틀려 있었다(2026-10-23 전수 확인).
