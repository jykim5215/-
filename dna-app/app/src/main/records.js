// 학습 데이터 파이프라인 (Layer 1)
// 앱 사용 자체가 학습 데이터를 만든다: 모든 단계에서 (입력, AI 초안, 인간 최종본)
// 3요소 쌍을 자동 저장하고, 저장 시 edit distance를 계산한다.
const crypto = require('crypto');
const { editDistance } = require('../shared/editDistance');

const STAGES = ['brainstorm', 'email', 'collect', 'analyze', 'draft', 'cardnews'];

function now() {
  return new Date().toISOString();
}

// AI 산출물 생성 직후 호출 → record_id 반환
function createRecord(store, { projectId, stage, input, aiOutput, modelVersion }) {
  if (!STAGES.includes(stage)) throw new Error(`알 수 없는 stage: ${stage}`);
  const id = crypto.randomUUID();
  store.run(
    `INSERT INTO records (record_id, project_id, stage, input, ai_output, model_version, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, stage, JSON.stringify(input || {}), aiOutput || '', modelVersion || '', now()]
  );
  store.persist();
  return id;
}

// 기자가 최종본을 저장할 때 호출 — edit distance 자동 계산
function finalizeRecord(store, recordId, humanFinal) {
  const rec = store.get('SELECT ai_output FROM records WHERE record_id = ?', [recordId]);
  if (!rec) throw new Error('레코드 없음: ' + recordId);
  const dist = editDistance(rec.ai_output, humanFinal);
  store.run(
    'UPDATE records SET human_final = ?, edit_distance = ? WHERE record_id = ?',
    [humanFinal, dist, recordId]
  );
  store.persist();
  return dist;
}

// 원클릭 피드백 위젯 (별점 + 태그 + 코멘트)
function setFeedback(store, recordId, { rating, tags = [], comment = '' }) {
  if (rating !== undefined && (rating < 1 || rating > 5)) {
    throw new Error('rating은 1~5여야 합니다.');
  }
  store.run('UPDATE records SET feedback = ? WHERE record_id = ?', [
    JSON.stringify({ rating, tags, comment }),
    recordId,
  ]);
  store.persist();
}

// ---- 개인정보/취재원 보호 마스킹 ----
// export 시 이메일·전화번호는 항상 마스킹, 취재원 실명은 이름 목록을 받아 마스킹.
function maskText(text, names = []) {
  let out = String(text)
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[이메일]')
    .replace(/\b0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}\b/g, '[연락처]');
  for (const name of names) {
    if (!name || name.length < 2) continue;
    out = out.split(name).join(name[0] + '○○');
  }
  return out;
}

// 데이터셋 export (JSONL, instruction-input-output 파인튜닝 형식과 호환되는 원시 레코드)
function exportDataset(store, { stage = null, maskNames = [], mask = true } = {}) {
  const rows = stage
    ? store.all('SELECT * FROM records WHERE stage = ? ORDER BY timestamp', [stage])
    : store.all('SELECT * FROM records ORDER BY timestamp');
  const m = (t) => (mask ? maskText(t, maskNames) : t);
  return rows
    .map((r) =>
      JSON.stringify({
        record_id: r.record_id,
        project_id: r.project_id,
        stage: r.stage,
        input: JSON.parse(m(r.input || '{}')),
        ai_output: m(r.ai_output || ''),
        human_final: r.human_final == null ? null : m(r.human_final),
        edit_distance: r.edit_distance,
        feedback: JSON.parse(r.feedback || '{}'),
        model_version: r.model_version,
        timestamp: r.timestamp,
      })
    )
    .join('\n');
}

// 데이터 거버넌스: 특정 프로젝트/취재원 관련 레코드 일괄 삭제
function deleteRecordsByProject(store, projectId) {
  store.run('DELETE FROM records WHERE project_id = ?', [projectId]);
  store.persist();
}

// 대시보드 지표: 단계별 평균 edit distance / 평점 (자동화 성숙도)
function metrics(store) {
  return store.all(`
    SELECT stage,
           COUNT(*) AS n,
           AVG(edit_distance) AS avg_edit_distance,
           AVG(json_extract(feedback, '$.rating')) AS avg_rating
    FROM records
    WHERE human_final IS NOT NULL
    GROUP BY stage
  `);
}

module.exports = {
  STAGES,
  createRecord,
  finalizeRecord,
  setFeedback,
  maskText,
  exportDataset,
  deleteRecordsByProject,
  metrics,
};
