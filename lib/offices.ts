// 사무실(길찾기 출발지) 공용 상수.
// 홈 지도(MapView) 길찾기 링크의 출발지이자, 이후 동선 지도의 사무실 마커로도 재사용한다.
// 좌표는 주소를 정본으로 두고 병기한 값이다(MapView 는 ulsan/gumi 를 마운트 시 주소로 재지오코딩).
// ※ '구미' 라벨의 실제 주소는 경북 칠곡군이다. 라벨과 행정구역이 다르지만 기존 표기를 유지한다.

export type Office = {
  code: string
  label: string
  address: string
  lat: number
  lng: number
}

export const OFFICES = [
  { code: 'dongtan', label: '동탄', address: '경기 화성시 동탄구 동탄대로24길 31-8', lat: 37.217719, lng: 127.108180 },
  { code: 'ulsan',   label: '울산', address: '울산 울주군 삼남읍 울산역로 274',      lat: 35.55424,  lng: 129.35841 },
  { code: 'gumi',    label: '구미', address: '경북 칠곡군 남중리1길 14',            lat: 36.0315,   lng: 128.3899 },
] as const

// code 로 사무실 항목을 찾는다. 없으면 undefined.
export function getOffice(code: string | null | undefined): (typeof OFFICES)[number] | undefined {
  if (!code) return undefined
  return OFFICES.find(o => o.code === code)
}
