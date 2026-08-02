// pptx XML 직접 편집 엔진 — 템플릿 충실성이 최우선.
// 원본 pptx를 zip으로 다루며 다음만 수행한다:
//   1) <a:t> 텍스트 노드 교체 (서식 <a:rPr>은 절대 건드리지 않음)
//   2) 슬라이드 복제: rId 자동 증가 할당 + presentation.xml <p:sldIdLst> 수동 등록
//   3) 슬라이드 삭제
//   4) 재패킹: 원본 zip 항목(theme 관계·content type 선언 포함)을 그대로 보존
// pptxgenjs 등으로 새로 그리는 방식은 금지.
const JSZip = require('jszip');
const { escapeXmlText, unescapeXmlText } = require('./escape');

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const SLIDE_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

async function loadPptx(buffer) {
  return JSZip.loadAsync(buffer);
}

async function savePptx(zip) {
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

// 존재하는 슬라이드 번호 목록 (비연속 번호 허용)
function listSlideNumbers(zip) {
  const nums = [];
  zip.forEach((relPath) => {
    const m = relPath.match(SLIDE_RE);
    if (m) nums.push(parseInt(m[1], 10));
  });
  return nums.sort((a, b) => a - b);
}

async function getSlideXml(zip, n) {
  const f = zip.file(`ppt/slides/slide${n}.xml`);
  if (!f) throw new Error(`slide${n}.xml 없음`);
  return f.async('string');
}

function setSlideXml(zip, n, xml) {
  zip.file(`ppt/slides/slide${n}.xml`, xml);
}

// 슬라이드의 모든 <a:t> 텍스트 (run 단위)
function extractRunTexts(xml) {
  const out = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(unescapeXmlText(m[1]));
  return out;
}

// 문단(a:p) 단위로 run들을 병합한 텍스트 목록 — 한 문장이 여러 run으로 쪼개진 경우 대응
function extractParagraphTexts(xml) {
  const paras = [];
  const pRe = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g;
  let pm;
  while ((pm = pRe.exec(xml)) !== null) {
    paras.push(extractRunTexts(pm[0]).join(''));
  }
  return paras;
}

// 문단 병합 텍스트가 oldText와 일치(공백 무시)하는 문단을 찾아,
// 첫 run에 newText를 넣고 나머지 run은 빈 문자열로 만든다.
// 서식은 첫 run의 <a:rPr>이 유지된다. 교체한 문단 수를 반환.
function replaceParagraphText(xml, oldText, newText, { all = false } = {}) {
  const norm = (s) => s.replace(/\s+/g, '');
  const target = norm(oldText);
  let count = 0;

  const newXml = xml.replace(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g, (para) => {
    if (!all && count > 0) return para;
    if (norm(extractRunTexts(para).join('')) !== target) return para;
    count++;
    let first = true;
    return para.replace(/<a:t(\s[^>]*)?>[\s\S]*?<\/a:t>/g, (_full, attrs) => {
      const hasPreserve = attrs && /xml:space="preserve"/.test(attrs);
      const attrStr = hasPreserve ? attrs : `${attrs || ''} xml:space="preserve"`;
      if (first) {
        first = false;
        return `<a:t${attrStr}>${escapeXmlText(newText)}</a:t>`;
      }
      return `<a:t${attrStr}></a:t>`;
    });
  });
  return { xml: newXml, count };
}

// 문단 교체 + 여러 줄 지원: 매칭된 a:p를 lines 수만큼 복제해
// 각 복제본에 한 줄씩 넣는다 (문단 서식·간격은 원본 그대로 복제됨).
function replaceParagraphTextMultiline(xml, oldText, lines) {
  const norm = (s) => s.replace(/\s+/g, '');
  const target = norm(oldText);
  let count = 0;
  const newXml = xml.replace(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g, (para) => {
    if (count > 0) return para;
    if (norm(extractRunTexts(para).join('')) !== target) return para;
    count++;
    return lines
      .map((line) => replaceParagraphText(para, oldText, line).xml)
      .join('');
  });
  return { xml: newXml, count };
}

// run 단위 단순 교체 (플레이스홀더가 run 하나에 온전히 들어있을 때)
function replaceRunText(xml, oldText, newText) {
  let count = 0;
  const newXml = xml.replace(
    /<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g,
    (full, attrs, body) => {
      if (unescapeXmlText(body) !== oldText) return full;
      count++;
      const hasPreserve = attrs && /xml:space="preserve"/.test(attrs);
      const attrStr = hasPreserve ? attrs : `${attrs || ''} xml:space="preserve"`;
      return `<a:t${attrStr}>${escapeXmlText(newText)}</a:t>`;
    }
  );
  return { xml: newXml, count };
}

// ---- presentation.xml / rels / content types 조작 ----

async function readText(zip, path) {
  const f = zip.file(path);
  if (!f) throw new Error(`${path} 없음`);
  return f.async('string');
}

function maxRId(relsXml) {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

function maxSldId(presentationXml) {
  let max = 255; // sldId는 256 이상이어야 함
  const re = /<p:sldId id="(\d+)"/g;
  let m;
  while ((m = re.exec(presentationXml)) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

// rId → 슬라이드 파일 번호 매핑
function slideRIdMap(relsXml) {
  const map = {};
  const re = /<Relationship[^>]*Id="(rId\d+)"[^>]*Target="slides\/slide(\d+)\.xml"[^>]*\/>/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) map[m[1]] = parseInt(m[2], 10);
  // 속성 순서가 다른 경우 대비
  const re2 = /<Relationship(?![^>]*Target="slides\/)[^>]*Target="slides\/slide(\d+)\.xml"[^>]*Id="(rId\d+)"[^>]*\/>/g;
  while ((m = re2.exec(relsXml)) !== null) map[m[2]] = parseInt(m[1], 10);
  return map;
}

// 프레젠테이션 표시 순서 (sldIdLst 순서대로 슬라이드 파일 번호)
async function slideOrder(zip) {
  const pres = await readText(zip, 'ppt/presentation.xml');
  const rels = await readText(zip, 'ppt/_rels/presentation.xml.rels');
  const map = slideRIdMap(rels);
  const order = [];
  const re = /<p:sldId id="\d+" r:id="(rId\d+)"\/>/g;
  let m;
  while ((m = re.exec(pres)) !== null) {
    if (map[m[1]] !== undefined) order.push(map[m[1]]);
  }
  return order;
}

// 슬라이드 복제. srcNum 슬라이드를 복사해 새 번호로 만들고
// sldIdLst에서 srcNum 바로 뒤에 등록한다. 새 슬라이드 번호를 반환.
async function cloneSlide(zip, srcNum) {
  const nums = listSlideNumbers(zip);
  if (!nums.includes(srcNum)) throw new Error(`slide${srcNum} 없음`);
  const newNum = Math.max(...nums) + 1;

  // 1) 슬라이드 XML + 관계 파일 복사
  const slideXml = await readText(zip, `ppt/slides/slide${srcNum}.xml`);
  zip.file(`ppt/slides/slide${newNum}.xml`, slideXml);
  const relsPath = `ppt/slides/_rels/slide${srcNum}.xml.rels`;
  if (zip.file(relsPath)) {
    zip.file(`ppt/slides/_rels/slide${newNum}.xml.rels`, await readText(zip, relsPath));
  }

  // 2) [Content_Types].xml에 Override 추가 (원본 선언 보존, 추가만)
  const ctPath = '[Content_Types].xml';
  let ct = await readText(zip, ctPath);
  const override = `<Override PartName="/ppt/slides/slide${newNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  if (!ct.includes(`/ppt/slides/slide${newNum}.xml`)) {
    ct = ct.replace('</Types>', `${override}</Types>`);
    zip.file(ctPath, ct);
  }

  // 3) presentation.xml.rels에 rId 자동 증가 할당
  const presRelsPath = 'ppt/_rels/presentation.xml.rels';
  let presRels = await readText(zip, presRelsPath);
  const newRId = `rId${maxRId(presRels) + 1}`;
  presRels = presRels.replace(
    '</Relationships>',
    `<Relationship Id="${newRId}" Type="${SLIDE_REL_TYPE}" Target="slides/slide${newNum}.xml"/></Relationships>`
  );
  zip.file(presRelsPath, presRels);

  // 4) presentation.xml <p:sldIdLst>에 순서대로 수동 등록 (src 바로 뒤)
  let pres = await readText(zip, 'ppt/presentation.xml');
  const rels = slideRIdMap(presRels);
  const srcRId = Object.keys(rels).find((k) => rels[k] === srcNum);
  const newSldId = maxSldId(pres) + 1;
  const entry = `<p:sldId id="${newSldId}" r:id="${newRId}"/>`;
  const srcEntryRe = new RegExp(`(<p:sldId id="\\d+" r:id="${srcRId}"/>)`);
  if (srcRId && srcEntryRe.test(pres)) {
    pres = pres.replace(srcEntryRe, `$1${entry}`);
  } else {
    pres = pres.replace('</p:sldIdLst>', `${entry}</p:sldIdLst>`);
  }
  zip.file('ppt/presentation.xml', pres);

  return newNum;
}

// 슬라이드 삭제: sldIdLst 항목 + rels + 파일 + content type 제거
async function deleteSlide(zip, num) {
  const presRelsPath = 'ppt/_rels/presentation.xml.rels';
  let presRels = await readText(zip, presRelsPath);
  const map = slideRIdMap(presRels);
  const rId = Object.keys(map).find((k) => map[k] === num);
  if (!rId) throw new Error(`slide${num}은 presentation rels에 없음`);

  let pres = await readText(zip, 'ppt/presentation.xml');
  pres = pres.replace(new RegExp(`<p:sldId id="\\d+" r:id="${rId}"/>`), '');
  zip.file('ppt/presentation.xml', pres);

  presRels = presRels.replace(
    new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*/>`),
    ''
  );
  zip.file(presRelsPath, presRels);

  let ct = await readText(zip, '[Content_Types].xml');
  ct = ct.replace(
    new RegExp(`<Override PartName="/ppt/slides/slide${num}\\.xml"[^>]*/>`),
    ''
  );
  zip.file('[Content_Types].xml', ct);

  zip.remove(`ppt/slides/slide${num}.xml`);
  zip.remove(`ppt/slides/_rels/slide${num}.xml.rels`);
}

// 슬라이드에서 도형 이름(name)으로 <p:pic>을 찾아 그 이미지를 교체한다.
// 프레임(위치·크기)·잠금은 그대로 두고 미디어 바이트만 바꾼다 → 템플릿 충실성 유지.
// ext가 원본과 다르면 새 미디어 파트로 넣고 rId Target·content type을 갱신한다.
async function replaceImageByShapeName(zip, slideNum, shapeName, imageBuffer, ext) {
  const slidePath = `ppt/slides/slide${slideNum}.xml`;
  const xml = await readText(zip, slidePath);

  // 1) 해당 도형의 <p:pic> 블록에서 r:embed 추출
  const picRe = /<p:pic>[\s\S]*?<\/p:pic>/g;
  let pic = null;
  let mm;
  while ((mm = picRe.exec(xml)) !== null) {
    if (mm[0].includes(`name="${shapeName}"`)) { pic = mm[0]; break; }
  }
  if (!pic) throw new Error(`slide${slideNum}에 도형 "${shapeName}"이(가) 없습니다.`);
  const embedM = pic.match(/<a:blip[^>]*r:embed="(rId\d+)"/);
  if (!embedM) throw new Error(`도형 "${shapeName}"에 이미지 blip이 없습니다.`);
  const rId = embedM[1];

  // 2) 슬라이드 rels에서 rId → 미디어 경로
  const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
  let rels = await readText(zip, relsPath);
  const relM = rels.match(new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*Target="([^"]+)"[^>]*/>`));
  if (!relM) throw new Error(`rels에서 ${rId}를 찾지 못했습니다.`);
  const curTarget = relM[1]; // 예: ../media/image2.png
  const curExt = (curTarget.split('.').pop() || '').toLowerCase();
  const newExt = (ext || curExt).toLowerCase().replace('jpeg', 'jpg') === 'jpg' ? 'jpg' : (ext || curExt).toLowerCase();

  if (newExt === curExt || (newExt === 'jpg' && curExt === 'jpeg')) {
    // 같은 확장자 → 바이트만 교체
    const mediaPath = 'ppt/' + curTarget.replace(/^\.\.\//, '');
    zip.file(mediaPath, imageBuffer);
  } else {
    // 다른 확장자 → 새 미디어 파트 + rId Target 갱신 + content type 보장
    const newName = `dna_${slideNum}_${Date.now()}.${newExt}`;
    zip.file(`ppt/media/${newName}`, imageBuffer);
    rels = rels.replace(
      new RegExp(`(<Relationship[^>]*Id="${rId}"[^>]*Target=")[^"]+("[^>]*/>)`),
      `$1../media/${newName}$2`
    );
    zip.file(relsPath, rels);
    // [Content_Types].xml에 확장자 Default 보장
    let ct = await readText(zip, '[Content_Types].xml');
    if (!new RegExp(`Extension="${newExt}"`, 'i').test(ct)) {
      const mime = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[newExt] || 'application/octet-stream';
      ct = ct.replace('</Types>', `<Default Extension="${newExt}" ContentType="${mime}"/></Types>`);
      zip.file('[Content_Types].xml', ct);
    }
  }
  return { rId, replaced: curTarget };
}

module.exports = {
  loadPptx,
  savePptx,
  replaceImageByShapeName,
  listSlideNumbers,
  getSlideXml,
  setSlideXml,
  extractRunTexts,
  extractParagraphTexts,
  replaceParagraphText,
  replaceParagraphTextMultiline,
  replaceRunText,
  cloneSlide,
  deleteSlide,
  slideOrder,
};
