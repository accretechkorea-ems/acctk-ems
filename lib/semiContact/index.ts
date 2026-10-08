// 반도체 고객 접촉 보고 — 순수 모듈 묶음. 화면·라우트·엑셀은 이 파일에서 가져온다.
//   fields   필드 등록표(라벨·섹션·선택지·이어쓰기·저장 위치)와 Action 줄 모양
//   prefill  이어쓰기(직전 보고에서 가져오기)와 바뀐 칸 찾기
//   validate 입력 검증(필드별 오류 문장)
//   storage  입력 객체 ↔ DB 행

export * from './fields'
export * from './prefill'
export * from './validate'
export * from './storage'
