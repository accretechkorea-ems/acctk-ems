import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // 번들 크기·브라우저 실측용 빌드(NEXT_DIST_DIR=.next-perf) — 빌드 산출물이라 검사 대상이 아니다.
    ".next-perf*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 명함 OCR 이 쓰는 남의 파일(tesseract.js 워커·코어) — 우리가 쓰지 않은 코드다.
    "public/ocr/**",
  ]),
  // 스타일 규칙은 배포를 막지 않도록 warn 으로 낮춘다(동작 문제 아님).
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      /**
       * 이름이 `_` 로 시작하는 인자·변수는 **일부러 쓰지 않는 것**이다(2026-11-21).
       *   const [_rid, value] = entry      // 앞자리는 안 쓴다는 표시
       *   .sort(([_sortKey, a], [, b]) => …)
       * 그 표시를 규칙이 몰라서 경고가 났다. 표시를 아는 규칙으로 바꾼다 —
       * 쓰지 않는 값을 지우는 것과 **이름으로 그렇다고 적어 두는 것**은 다른 일이다.
       */
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
  /**
   * **CommonJS 로 돌리는 파일** — 하네스(scripts/*.js)와 한 번 쓰는 도구(루트의 .js).
   *
   * node 로 직접 돌리므로 require() 가 유일한 길이다(import 로 바꾸면 돌지 않는다).
   * 하네스는 그 경고를 피하려고 `const load = module.require.bind(module)` 같은 우회를
   * 쓰고 있었는데, 규칙을 파일 갈래로 끄는 것이 그 우회보다 정직하다.
   */
  {
    files: ["scripts/**/*.js", "scripts/**/*.mjs", "*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
