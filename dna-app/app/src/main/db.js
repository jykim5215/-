// SQLite 저장 계층 (sql.js — WASM, 네이티브 빌드 불필요)
// 파일로 영속화: 변경 후 persist() 호출 시 db.export()를 디스크에 기록.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

let SQL = null;

async function ensureSql() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) =>
        path.join(path.dirname(require.resolve('sql.js')), file),
    });
  }
  return SQL;
}

class Store {
  constructor(db, filePath) {
    this.db = db;
    this.filePath = filePath; // null이면 메모리 전용 (테스트)
  }

  static async open(filePath = null) {
    await ensureSql();
    let db;
    if (filePath && fs.existsSync(filePath)) {
      db = new SQL.Database(fs.readFileSync(filePath));
    } else {
      db = new SQL.Database();
    }
    db.run(SCHEMA);
    return new Store(db, filePath);
  }

  persist() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.filePath);
  }

  run(sql, params = []) {
    this.db.run(sql, params);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  close() {
    this.db.close();
  }
}

module.exports = { Store };
