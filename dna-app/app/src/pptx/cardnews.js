// 카드뉴스 생성기 — DNA 공식 2025 개편 템플릿 기반.
// 폰트·색·레이아웃·로고·여백은 절대 수정하지 않고 텍스트만 교체한다.
//
// plan 형식:
// {
//   coverTitle: "1~2줄 제목 (\n으로 줄 구분)",
//   category: "사회",
//   cards: [{ title, body, photoCredit? }, ...],   // 개요→개념→Q&A→전망 순
//   lastPageVariant?: 6|7|8|9                       // 기본 9 (마스코트)
// }
const fs = require('fs');
const path = require('path');
const eng = require('./engine');
const { validateCardPlan } = require('./cardnewsRules');

const MAPPING = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'mapping.json'), 'utf8')
);

async function fillCoverSlide(zip, slideNum, plan, mapping) {
  let xml = await eng.getSlideXml(zip, slideNum);
  const lines = plan.coverTitle.split('\n');
  const r = eng.replaceParagraphTextMultiline(xml, mapping.cover.titlePlaceholder, lines);
  if (r.count === 0) throw new Error('커버 제목 플레이스홀더를 찾지 못했습니다.');
  xml = r.xml;
  const c = eng.replaceParagraphText(xml, mapping.cover.categoryPlaceholder, plan.category);
  if (c.count === 0) throw new Error('카테고리 플레이스홀더를 찾지 못했습니다.');
  eng.setSlideXml(zip, slideNum, c.xml);
}

async function fillBodySlide(zip, slideNum, card, mapping) {
  let xml = await eng.getSlideXml(zip, slideNum);
  const m = mapping.body;

  // 제목 (Pretendard ExtraBold 40pt 서식 유지)
  let r = eng.replaceParagraphText(xml, m.titlePlaceholder, card.title);
  if (r.count === 0) throw new Error(`본문 제목 플레이스홀더 매칭 실패 (slide${slideNum})`);
  xml = r.xml;

  // 본문: 리드 문단에 여러 문단 주입, 나머지 예시 문단은 비움
  const bodyParas = String(card.body).split(/\n{1,}/).filter((s) => s.trim());
  r = eng.replaceParagraphTextMultiline(xml, m.leadPlaceholder, bodyParas);
  if (r.count === 0) throw new Error(`본문 플레이스홀더 매칭 실패 (slide${slideNum})`);
  xml = r.xml;
  for (const ph of m.restPlaceholders) {
    xml = eng.replaceParagraphText(xml, ph, '').xml;
  }

  // 사진출처: 퍼온 사진은 "사진 = ○○ 제공", 직접 촬영/없음은 빈 값
  const credit = card.photoCredit ? `사진 = ${card.photoCredit} 제공` : '';
  xml = eng.replaceParagraphText(xml, m.creditPlaceholder, credit).xml;

  eng.setSlideXml(zip, slideNum, xml);
}

// templateBuffer → 완성된 pptx Buffer
async function generateCardnews(templateBuffer, plan) {
  const check = validateCardPlan(plan);
  if (!check.ok) {
    const err = new Error('카드뉴스 규격 위반:\n' + check.errors.join('\n'));
    err.validation = check;
    throw err;
  }

  const zip = await eng.loadPptx(templateBuffer);
  const m = MAPPING;

  // 1) 본문 카드 복제 (cloneSlide는 원본 바로 뒤에 삽입하므로 역순으로 복제해 순서 유지)
  const bodySrc = m.body.slide;
  const cloneNums = [];
  for (let i = plan.cards.length - 1; i >= 0; i--) {
    const n = await eng.cloneSlide(zip, bodySrc);
    cloneNums.unshift(n); // cloneNums[i] = cards[i]의 슬라이드 번호... 역순 복제이므로 아래에서 재정렬
  }
  // 역순 복제 결과: 마지막에 복제한 것이 카드 1. 표시 순서 기준으로 재매핑.
  const order = await eng.slideOrder(zip);
  const clonesInOrder = order.filter((n) => cloneNums.includes(n));
  for (let i = 0; i < plan.cards.length; i++) {
    await fillBodySlide(zip, clonesInOrder[i], plan.cards[i], m);
  }

  // 2) 커버 채우기
  await fillCoverSlide(zip, m.cover.slide, plan, m);

  // 3) 불필요 슬라이드 삭제: 규격 안내, 대체 커버, 예시 본문 2종, 미선택 마무리 장
  const last = plan.lastPageVariant || m.lastPages.default;
  if (!m.lastPages.variants.includes(last)) {
    throw new Error(`마무리 장 변형은 ${m.lastPages.variants.join(',')} 중 하나여야 합니다.`);
  }
  const toDelete = [
    m.specSlide,
    m.cover.altSlide,
    m.body.slide,
    m.body.altSlide,
    ...m.lastPages.variants.filter((v) => v !== last),
  ];
  for (const n of toDelete) await eng.deleteSlide(zip, n);

  const finalOrder = await eng.slideOrder(zip);
  const buffer = await eng.savePptx(zip);
  return {
    buffer,
    warnings: [
      ...check.warnings,
      '한국어 폰트(나눔스퀘어_ac, Pretendard)가 없는 환경에서는 정렬 민감 요소를 실제 폰트 환경에서 확인 필요.',
    ],
    slideCount: finalOrder.length,
  };
}

module.exports = { generateCardnews, MAPPING };
