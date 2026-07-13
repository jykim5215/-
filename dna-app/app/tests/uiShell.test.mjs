import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

test('개발자 모드는 첫 화면에서 숨겨지고 CSS 표시 규칙보다 우선한다', () => {
  assert.match(index, /id="devModeBtn"[^>]*\shidden\b/);
  assert.match(index, /id="devModeBtn"[^>]*aria-hidden="true"/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(app, /if \(!state\.developerMode\) return;/);
});

test('자료 수집 화면은 다중 파일 드롭과 Drive 가져오기를 제공한다', () => {
  assert.match(app, /id="colDropZone"/);
  assert.match(app, /id="colFile" multiple/);
  assert.match(app, /id="colDriveFileBtn"/);
  assert.match(app, /processIncomingFiles\(event\.dataTransfer\?\.files/);
});

test('사이드 메뉴는 기능군으로 구분하고 프로젝트를 목록으로 모두 표시한다', () => {
  assert.match(index, /id="createGroupLabel">기사 제작</);
  assert.match(index, /id="communicationGroupLabel">소통</);
  assert.match(index, /id="manageGroupLabel">관리</);
  assert.match(index, /id="projectList"[^>]*aria-label="프로젝트 목록"/);
  assert.doesNotMatch(index, /id="projectSelect"/);
  assert.match(app, /function renderProjectList\(\)/);
  assert.match(styles, /\.project-row\.active/);
});

test('새 프로젝트는 팝업이 아니라 전체 입력 화면으로 연다', () => {
  assert.match(app, /function openNewProjectView\(\)/);
  assert.match(app, /function renderNewProjectView\(el\)/);
  assert.match(app, /id="newProjectTitle"/);
  assert.match(app, /name="newProjectType"/);
  assert.match(app, /id="newProjectKeywords"/);
  assert.match(app, /id="newProjectDeadline"/);
  assert.match(app, /\$\('#newProjectBtn'\)\.onclick = openNewProjectView/);
  assert.match(styles, /\.project-create-form\s*\{\s*display:\s*grid/);
});
