// 첨부파일 형식 판별 — 앞머리 바이트(매직 넘버)로 실제 형식을 확인한다.
//
// 브라우저가 보내는 MIME 은 믿을 수 없다. 확장자만 바꿔 올린 실행 파일도 MIME 은 그럴듯하게
// 붙고, .msg·.eml 처럼 브라우저가 형식을 모르는 파일은 application/octet-stream 으로 온다.
// 그래서 「무엇이라고 말하는가」가 아니라 「앞머리가 무엇인가」를 본다.
//
// 이 파일에는 순수한 판정만 둔다 — 서비스 레포트 첨부(app/api/service-attachment)와
// 의뢰서 교신 첨부(app/api/inquiry-attachment)가 같은 것을 쓴다.
// 두 곳이 각자 sniff 를 들고 있으면 한쪽만 고쳐져 허용 범위가 갈린다.

/**
 * 앞머리로 형식을 가리는 데 필요한 바이트 수.
 *
 * 판정 함수에는 이만큼만 잘라 넘긴다. 20MB 짜리 버퍼를 통째로 넘기면 언젠가 누가
 * 전체를 문자열로 바꾸거나 배열로 펼치는 코드를 더하게 되고, 그 순간 큰 파일에서
 * 스택이 터진다. 구조적으로 못 하게 막아 둔다 — 아래 판정들은 전부 8바이트 이하만 본다.
 */
export const SNIFF_HEAD_BYTES = 16

/** 판정 함수에 넘길 앞머리. 원본은 건드리지 않는다(subarray 는 복사하지 않는다). */
export const headOf = (b: Buffer): Buffer => b.subarray(0, SNIFF_HEAD_BYTES)

/** zip 컨테이너(PK..). xlsx·docx·zip 이 전부 여기에 해당한다. 안쪽까지 열어 보지는 않는다. */
export function isZip(b: Buffer): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
}

/** OLE2 복합문서. 옛 xls·doc 과 아웃룩 .msg 가 같은 컨테이너를 쓴다. */
export function isOle2(b: Buffer): boolean {
  return b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
}

/** PDF. */
export function isPdf(b: Buffer): boolean {
  return b.subarray(0, 4).toString('latin1') === '%PDF'
}

export type DocType = { ext: string; sniff: (b: Buffer) => boolean }

/**
 * 문서 형식 표 — MIME 으로 찾는다. 서비스 레포트 첨부가 지금까지 써 온 목록 그대로다.
 * 이 상수의 내용을 바꾸면 그쪽 허용 범위도 함께 바뀐다(늘릴 때는 그 점을 보고 결정한다).
 */
export const OFFICE_DOC_TYPES: Record<string, DocType> = {
  'application/pdf': { ext: 'pdf', sniff: isPdf },
  // xlsx·docx 는 zip 컨테이너다(PK..). 안쪽까지 열어 보지는 않는다.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', sniff: isZip },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', sniff: isZip },
  // 옛 xls·doc 은 OLE2 복합문서다.
  'application/vnd.ms-excel': { ext: 'xls', sniff: isOle2 },
  'application/msword': { ext: 'doc', sniff: isOle2 },
}
