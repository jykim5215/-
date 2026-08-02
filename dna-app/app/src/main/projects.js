// 프로젝트 / 자료 / 단계 산출물 CRUD
const crypto = require('crypto');

const now = () => new Date().toISOString();

function createProject(store, { title, keywords = [], articleType = '' }) {
  const id = crypto.randomUUID();
  store.run(
    `INSERT INTO projects (id, title, keywords, article_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, title, JSON.stringify(keywords), articleType, now(), now()]
  );
  store.persist();
  return id;
}

function listProjects(store) {
  return store
    .all('SELECT * FROM projects ORDER BY updated_at DESC')
    .map((p) => ({ ...p, keywords: JSON.parse(p.keywords || '[]') }));
}

function getProject(store, id) {
  const p = store.get('SELECT * FROM projects WHERE id = ?', [id]);
  return p ? { ...p, keywords: JSON.parse(p.keywords || '[]') } : null;
}

function setStage(store, id, stage) {
  store.run('UPDATE projects SET current_stage = ?, updated_at = ? WHERE id = ?', [
    stage, now(), id,
  ]);
  store.persist();
}

// 출처 없는 자료는 저장 불가 (앱 레벨 + DB CHECK 이중 방어)
function addMaterial(store, { projectId, kind, title, content = '', source, meta = {} }) {
  if (!source || !String(source).trim()) {
    throw new Error('출처(source)가 없는 자료는 저장할 수 없습니다. 저작권법 제28조 — 출처 표시는 필수입니다.');
  }
  const id = crypto.randomUUID();
  store.run(
    `INSERT INTO materials (id, project_id, kind, title, content, source, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, kind, title, content, String(source).trim(), JSON.stringify(meta), now()]
  );
  store.persist();
  return id;
}

function listMaterials(store, projectId) {
  return store
    .all('SELECT * FROM materials WHERE project_id = ? ORDER BY created_at', [projectId])
    .map((m) => ({ ...m, meta: JSON.parse(m.meta || '{}') }));
}

function deleteMaterial(store, id) {
  store.run('DELETE FROM materials WHERE id = ?', [id]);
  store.persist();
}

// 자료 편집 — 출처는 여전히 필수(빈 값이면 거부)
function updateMaterial(store, id, { title, content, source }) {
  if (source !== undefined && !String(source).trim()) {
    throw new Error('출처는 비울 수 없습니다. 저작권법 제28조 — 출처 표시는 필수입니다.');
  }
  const cur = store.get('SELECT * FROM materials WHERE id = ?', [id]);
  if (!cur) throw new Error('자료를 찾을 수 없습니다.');
  store.run('UPDATE materials SET title = ?, content = ?, source = ? WHERE id = ?', [
    title ?? cur.title,
    content ?? cur.content,
    source !== undefined ? String(source).trim() : cur.source,
    id,
  ]);
  store.persist();
}

function saveStageOutput(store, { projectId, stage, content }) {
  const prev = store.get(
    'SELECT MAX(version) AS v FROM stage_outputs WHERE project_id = ? AND stage = ?',
    [projectId, stage]
  );
  const version = (prev?.v || 0) + 1;
  const id = crypto.randomUUID();
  store.run(
    `INSERT INTO stage_outputs (id, project_id, stage, version, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, projectId, stage, version, content, now()]
  );
  store.persist();
  return { id, version };
}

function latestStageOutput(store, projectId, stage) {
  return store.get(
    `SELECT * FROM stage_outputs WHERE project_id = ? AND stage = ?
     ORDER BY version DESC LIMIT 1`,
    [projectId, stage]
  );
}

// 단계별 버전 이력 (본문 제외한 메타 — 목록용). 최신 버전 우선.
function listStageVersions(store, projectId, stage) {
  return store.all(
    `SELECT id, version, created_at, length(content) AS chars FROM stage_outputs
     WHERE project_id = ? AND stage = ? ORDER BY version DESC`,
    [projectId, stage]
  );
}

function getStageOutput(store, id) {
  return store.get('SELECT * FROM stage_outputs WHERE id = ?', [id]);
}

// 프로젝트 삭제 — 연관 자료·산출물도 함께. (학습 레코드는 별도 거버넌스로 관리)
function deleteProject(store, id) {
  store.run('DELETE FROM materials WHERE project_id = ?', [id]);
  store.run('DELETE FROM stage_outputs WHERE project_id = ?', [id]);
  store.run('DELETE FROM projects WHERE id = ?', [id]);
  store.persist();
}

function renameProject(store, id, title) {
  if (!title || !title.trim()) throw new Error('제목은 비울 수 없습니다.');
  store.run('UPDATE projects SET title = ?, updated_at = ? WHERE id = ?', [title.trim(), now(), id]);
  store.persist();
}

module.exports = {
  createProject,
  listProjects,
  getProject,
  setStage,
  renameProject,
  deleteProject,
  addMaterial,
  listMaterials,
  deleteMaterial,
  updateMaterial,
  saveStageOutput,
  latestStageOutput,
  listStageVersions,
  getStageOutput,
};
