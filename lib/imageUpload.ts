// 서버가 받는 data URL 이미지의 검증. 라우트에서만 쓴다(Buffer 를 쓰므로 브라우저용이 아니다).
//
// 화면이 canvas 로 줄여 보내지만, 화면을 거치지 않는 호출을 가정하고 여기서 다시 본다.
//   · 선언된 MIME 만 믿지 않고 앞머리 바이트로 실제 형식을 확인한다
//   · 크기 상한을 넘는지 본다
// 파일명은 부르는 쪽(서버)이 정한다 — 클라이언트가 보낸 이름은 쓰지 않는다(경로 조작·덮어쓰기 방지).

export type ParsedImage = { bytes: Buffer; ext: 'jpg' | 'png' | 'webp'; contentType: string }

export type ParseImageResult =
  | { ok: true; image: ParsedImage | null }
  | { ok: false; error: string }

/**
 * @param raw     'data:image/jpeg;base64,...' 문자열. 비었으면 image: null 로 통과한다.
 * @param maxBytes 디코딩 후 최대 바이트
 * @param label   오류 문구에 쓰는 이름('명함' · '공지 이미지' 등)
 */
export function parseDataUrlImage(raw: unknown, maxBytes: number, label: string): ParseImageResult {
  if (raw == null || raw === '') return { ok: true, image: null }
  if (typeof raw !== 'string') return { ok: false, error: `${label}을(를) 읽을 수 없습니다.` }

  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return { ok: false, error: `${label}은(는) 이미지 파일만 올릴 수 있습니다.` }

  let bytes: Buffer
  try {
    bytes = Buffer.from(m[2], 'base64')
  } catch {
    return { ok: false, error: `${label}을(를) 읽을 수 없습니다.` }
  }
  if (bytes.length === 0) return { ok: false, error: `${label}을(를) 읽을 수 없습니다.` }
  if (bytes.length > maxBytes) {
    return { ok: false, error: `${label}은(는) ${Math.floor(maxBytes / (1024 * 1024))}MB 를 넘을 수 없습니다.` }
  }

  // 앞머리 바이트로 실제 형식을 본다. 선언된 MIME 과 다르면 거부한다.
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isWebp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  const actual = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null
  if (!actual || actual !== m[1]) return { ok: false, error: `${label}은(는) 이미지 파일만 올릴 수 있습니다.` }

  const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp'
  return { ok: true, image: { bytes, ext, contentType: actual } }
}
