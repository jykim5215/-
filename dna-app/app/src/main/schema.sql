-- DNA 편집실 데이터 스키마 v1
-- 학습 데이터 파이프라인(Layer 1)의 (입력, AI 초안, 인간 최종본) 3요소 쌍이 records에 쌓인다.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',      -- JSON array
  article_type TEXT DEFAULT '',             -- 스트레이트|인터뷰|기획|사설
  current_stage TEXT NOT NULL DEFAULT 'brainstorm',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 모든 자료는 출처(source)가 비어 있으면 저장 불가 (저작권법 제28조 출처 표시 원칙)
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('url','file','transcript','note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  meta TEXT NOT NULL DEFAULT '{}',           -- JSON: 작성자/날짜/URL 등
  created_at TEXT NOT NULL
);

-- 단계별 현재 산출물 (버전 관리)
CREATE TABLE IF NOT EXISTS stage_outputs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  stage TEXT NOT NULL CHECK (stage IN ('brainstorm','email','collect','analyze','draft','cardnews')),
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- 학습 레코드: (input, ai_output, human_final) 3요소 쌍 + 피드백
CREATE TABLE IF NOT EXISTS records (
  record_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('brainstorm','email','collect','analyze','draft','cardnews')),
  input TEXT NOT NULL DEFAULT '{}',          -- JSON: {keywords, materials, context}
  ai_output TEXT NOT NULL DEFAULT '',
  human_final TEXT,                          -- 기자 수정 완료본 (NULL = 미완)
  edit_distance INTEGER,                     -- 자동 계산 수정량 지표
  feedback TEXT NOT NULL DEFAULT '{}',       -- JSON: {rating, tags, comment}
  model_version TEXT NOT NULL DEFAULT '',    -- 모델 ID + 프롬프트 버전
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id);
CREATE INDEX IF NOT EXISTS idx_records_stage ON records(stage);
CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id);
