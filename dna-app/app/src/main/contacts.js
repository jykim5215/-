// 메일 주소록 — 보낸 메일의 수신자와 받은 메일의 발신자를 자동 수집해
// 작성창 받는 사람 자동완성에 사용한다. (DGIST 웹메일의 주소 찾기 대응)
// 저장 형태: [{ name, email, count, lastAt }] — count 많고 최근인 순.

const MAX_CONTACTS = 400;

// "이름 <a@b.c>" | "a@b.c" | "a@b.c, 이름 <d@e.f>" → [{name, email}]
function parseAddressEntries(raw) {
  const out = [];
  const text = String(raw || '');
  // 꺾쇠 표기 우선 추출
  const bracketRe = /("?([^"<>,;]*?)"?\s*)?<([^<>@\s]+@[^<>\s]+\.[^<>\s]+)>/g;
  let m;
  const consumed = [];
  while ((m = bracketRe.exec(text))) {
    out.push({ name: (m[2] || '').trim(), email: m[3].trim().toLowerCase() });
    consumed.push(m[0]);
  }
  // 꺾쇠 없이 나열된 주소
  let rest = text;
  for (const c of consumed) rest = rest.replace(c, ' ');
  for (const piece of rest.split(/[,;]/)) {
    const email = piece.trim();
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      out.push({ name: '', email: email.toLowerCase() });
    }
  }
  return out;
}

// 기존 목록에 새 항목 병합. 같은 이메일은 count 증가, 이름은 더 긴(정보 많은) 쪽 유지.
function mergeContacts(existing, rawEntries, now = new Date().toISOString()) {
  const map = new Map();
  for (const c of Array.isArray(existing) ? existing : []) {
    if (c && c.email) map.set(String(c.email).toLowerCase(), { ...c });
  }
  const list = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
  for (const raw of list) {
    for (const { name, email } of parseAddressEntries(raw)) {
      const prev = map.get(email);
      if (prev) {
        prev.count = (prev.count || 0) + 1;
        prev.lastAt = now;
        if (name && name.length > (prev.name || '').length) prev.name = name;
      } else {
        map.set(email, { name: name || '', email, count: 1, lastAt: now });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.count || 0) - (a.count || 0) || String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
    .slice(0, MAX_CONTACTS);
}

// 자동완성 검색: 이름·이메일 부분일치 (대소문자 무시)
function searchContacts(contacts, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (contacts || []).slice(0, limit);
  return (contacts || [])
    .filter((c) => String(c.email || '').toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q))
    .slice(0, limit);
}

module.exports = { parseAddressEntries, mergeContacts, searchContacts, MAX_CONTACTS };
