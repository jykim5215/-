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
