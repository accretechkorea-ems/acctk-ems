// geocode_update.js
// 실행: node geocode_update.js
// 완료 후 생성된 geocode_update.sql을 Supabase SQL Editor에서 실행

const https = require('https');
const fs = require('fs');

// 실행 전 환경변수 설정: export KAKAO_REST_API_KEY=<키값>
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
if (!KAKAO_KEY) { console.error('KAKAO_REST_API_KEY 환경변수를 설정해주세요.'); process.exit(1); }

const companies = [
  { name: 'TSP', address: '경북 구미시 옥계2공단로 45' },
  { name: '세현정밀(주)', address: '경북 구미시 신동면 봉산리 제4단지 11-1블럭 23롯트' },
  { name: 'C&M(씨엔엠㈜)', address: '경남 김해시 안동 259-1' },
  { name: '케이엔티(KNT)', address: '대구 달성군 유가읍 테크노대로6길 33' },
  { name: '경일기계', address: '경북 경주시 외동읍 문산공단길325' },
  { name: '대동기어㈜', address: '경남 사천시 사남면 공단로 71' },
  { name: '오리엔스', address: '경북 경주시 안강읍 안현로 1055-51' },
  { name: '태원', address: '경남 창원시 성산구 완암로 50' },
  { name: '진일정밀기계', address: '경남 양산시 소주공단2길 42' },
  { name: '금우정밀', address: '경남 진주시 상평동 201-5' },
  { name: '피앤이글로벌', address: '대구광역시 달서구 달구벌대로 226길 10' },
  { name: 'NEK (엔이케이)', address: '경남 함안군 칠서면 공단서 3길 18' },
  { name: '대륭공업사', address: '경상남도 진주시 대신로 184번길 21' },
  { name: '금영정공', address: '대구 달서구 성서로 9길 55' },
  { name: '삼진정밀', address: '경남 창녕군 장마면 영산장마로 53' },
  { name: '청룡테크', address: '경남 사천시 사남면 공단로 23-45' },
  { name: '프로솔', address: '경남 사천시 축동면 내축로 21-1' },
  { name: '현우정공', address: '경남 김해시 진례면 담안리1396-2' },
  { name: '현대자동차㈜ (A엔진)', address: '울산광역시 북구 양정동 700' },
  { name: '우진기어', address: '경남 김해시 진영읍 하계로 240번길 17-16' },
  { name: '일진에이테크', address: '울산 남구 산업로382번길 49' },
  { name: '르노삼성자동차', address: '부산 강서구 르노삼성대로 61' },
  { name: '명천공업', address: '경남 사천시 사남면 공단1로 59-37' },
  { name: '넥스턴', address: '경기도 용인시 기흥읍 고매리 234' },
  { name: '피엠티', address: '경기도 화성시 정남면 괘량리 875-7' },
  { name: '한국SMC공압(주)', address: '대전 대덕구 신일동 1673-2' },
  { name: '㈜원진산업', address: '경기도 시흥시 은행동 103-2' },
  { name: '㈜YASKAWA', address: '경기도 수원시 영통구 영통동 980-3' },
  { name: '에스텍㈜', address: '충청북도 진천군 이월면 동성리 370-1' },
  { name: '캐논코리아비즈니스솔루션', address: '경기도 안산시 단원구 시화벤처로 575' },
  { name: '한국자동차 부품연구원', address: '경기도 시흥시 오이도로 49' },
  { name: '디엠테크', address: '경기도 시흥시 군자동 75-2' },
  { name: '일진글로벌', address: '충북 제천시 왕암동' },
  { name: '대동전자', address: '서울특별시 금천구 가산디지털로 1로 33' },
  { name: 'LK엔지니어링', address: '경기도 화성시 동탄산단 6길 53-37' },
  { name: '광명', address: '경기도 화성시 팔탄면 버들로 1362번길' },
  { name: '일진기계', address: '충북 청주시 흥덕구 오송읍 오송생명11로 259' },
  { name: '(주)신우 1공장', address: '경북 포항시 남구 장기면 장기로 646' },
  { name: '현주산업', address: '경남 진주시 정촌면 산업로 30' },
  { name: '한양인더스트리', address: '경기도 화성시 정남면 괘랑보통길 32' },
  { name: '태성테크윈', address: '경상남도 김해시 주촌면 서부로1499번길 101-59' },
  { name: '성보텍', address: '경남 김해시 대동면 대동산단3로 160' },
  { name: '데바', address: '경기도 오산시 가장산업서북로 110-23' },
  { name: '프레스토라이트아시아', address: '경기도 이천시 부발읍 황무로 1965번길 96' },
  { name: '카펙발레오(성주공장)', address: '경북 성주군 성주읍 성주산업단지로2길 22' },
  { name: '성신앤큐', address: '대구광역시 달성군 다사읍 세천로1길 95' },
  { name: '금정테크', address: '경남 창원시 북면 동전산단동로 58' },
  { name: '영신정공주식회사', address: '경북 경주시 천북면 모아오야길 156' },
  { name: 'KC ENG', address: '경기도 평택시 서탄면 수월암길 54-19' },
  { name: '원탑', address: '인천광역시 남동구 고잔동 67-7' },
  { name: '토소쿼츠코리아', address: '충북 청주시 청원구 오창읍 과학산업로4로 86' },
  { name: '제스코', address: '경기도 화성시 금곡로163번길 42-27' },
  { name: '삼인정공', address: '경북 경주시 천북면 신당소티고개길 54-34' },
  { name: '오토인더스트리', address: '경상북도 경주시 건천읍 신평공단길 60' },
  { name: '테스코', address: '경기도 화성시 양감면 송말길 30-9' },
  { name: '㈜신우 2공장', address: '경북 포항시 남구 장기면 장기로568' },
  { name: '세바', address: '경북 구미시 옥성면 선상동로 649' },
  { name: '제현정밀', address: '부산광역시 사하구 장평로 62' },
  { name: 'TJT ENG', address: '대전광역시 유성구 테크노 2로 199' },
  { name: '영신정공주식회사(화산공장)', address: '경북 경주시 천북면 화산공단길 247-90' },
  { name: '삼진정공', address: '충남 천안시 동남구 성남면 대흥1길 68' },
  { name: '신화정밀㈜', address: '경북 구미시 산동면 첨단기업5로 110-7' },
  { name: '우림정밀', address: '경남 진주시 도동로 122' },
  { name: '금호공업', address: '경남 진주시 정촌면 산업로 104' },
  { name: '엔아이텍', address: '경기도 용인시 수지구 신수로 767' },
  { name: 'LG전자(주) 창원공장', address: '경남 창원시 성산구 LG로 75' },
  { name: '화신테크', address: '경북 경주시 외동읍 모화리' },
];

function geocode(address) {
  return new Promise((resolve) => {
    const path = '/v2/local/search/address.json?query=' + encodeURIComponent(address);
    const options = {
      hostname: 'dapi.kakao.com',
      path: path,
      headers: { 'Authorization': 'KakaoAK ' + KAKAO_KEY }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.documents && json.documents.length > 0) {
            resolve({ lat: json.documents[0].y, lng: json.documents[0].x });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const sqls = [];
  const failed = [];

  for (const c of companies) {
    const coords = await geocode(c.address);
    if (coords) {
      console.log('OK: ' + c.name + ' -> ' + coords.lat + ', ' + coords.lng);
      const safeName = c.name.replace(/'/g, "''");
      sqls.push(
        "UPDATE customers SET latitude = " + coords.lat + ", longitude = " + coords.lng +
        " WHERE company_name = '" + safeName + "' AND (latitude IS NULL OR latitude = 0);"
      );
    } else {
      console.log('FAIL: ' + c.name + ' (' + c.address + ')');
      failed.push(c);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  fs.writeFileSync('geocode_update.sql', sqls.join('\n'), 'utf8');
  console.log('\n완료! ' + sqls.length + '개 성공, ' + failed.length + '개 실패');
  console.log('-> geocode_update.sql 파일을 Supabase SQL Editor에서 실행해주세요!');

  if (failed.length > 0) {
    console.log('\n실패 목록:');
    failed.forEach(f => console.log('  - ' + f.name + ': ' + f.address));
  }
}

main();
