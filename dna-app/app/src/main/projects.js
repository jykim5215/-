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

module.exports = {
  createProject,
  listProjects,
  getProject,
  setStage,
  addMaterial,
  listMaterials,
  saveStageOutput,
  latestStageOutput,
};
