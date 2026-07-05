// Levenshtein 편집 거리 — 학습 레코드의 수정량(edit_distance) 지표.
// 두 행만 유지하는 O(min(n,m)) 메모리 구현. 매우 긴 텍스트는 앞부분만 비교(상한)해
// UI가 멈추지 않게 한다.
const MAX_LEN = 20000;

function editDistance(a = '', b = '') {
  a = String(a).slice(0, MAX_LEN);
  b = String(b).slice(0, MAX_LEN);
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length < b.length) [a, b] = [b, a]; // b가 짧은 쪽

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// 0(동일)~1(전부 수정) 정규화 비율
function editRatio(a = '', b = '') {
  const max = Math.max(String(a).length, String(b).length, 1);
  return editDistance(a, b) / Math.min(max, MAX_LEN);
}

module.exports = { editDistance, editRatio };
