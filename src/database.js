const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs');
const path = require('node:path');
const schemas = require('./schema.json');
class DatabaseManager {
  constructor(filename) {
    this.directory = filename && filename !== ':memory:' ? path.dirname(filename) : process.env.SWIZ_DATA_DIR || path.join(__dirname, '..');
    this.filename = filename || path.join(this.directory, 'swiz_bot.db');
    if (this.filename !== ':memory:') fs.mkdirSync(path.dirname(this.filename), {recursive:true});
    this.db = new sqlite3.Database(this.filename);
    this.db.configure('busyTimeout', 5000);
    this.ready = this.initialize();
  }
  _run(sql, params = []) {
    return new Promise((resolve, reject) => this.db.run(sql, Array.isArray(params) ? params : [params], function(error) {
      error ? reject(error) : resolve({lastID:this.lastID, changes:this.changes});
    }));
  }
  _query(sql, params = []) {
    return new Promise((resolve,reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  }
  async initialize() {
    await this._run('PRAGMA journal_mode = WAL');
    await this._run('PRAGMA foreign_keys = ON');
    for (const schema of schemas) await this._run(schema);
    for (const key of ['ticket_sayaci','toplam_uyari','panel_kanal','panel_mesaj','panel_sayfa','etkinlik_sayaci']) {
      await this._run('INSERT OR IGNORE INTO config(anahtar,deger) VALUES (?, ?)', [key,'0']);
    }
    await this._run(`UPDATE config SET deger = MAX(CAST(deger AS INTEGER), COALESCE((SELECT MAX(ticket_no) FROM ticket_log),0)) WHERE anahtar = 'ticket_sayaci'`);
    await this._run(`CREATE TABLE IF NOT EXISTS tickets (
      ticket_no INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      channel_id TEXT, status TEXT NOT NULL DEFAULT 'creating', created_at TEXT NOT NULL,
      closed_at TEXT, assigned_to TEXT, close_reason TEXT)`);
    await this._run(`CREATE UNIQUE INDEX IF NOT EXISTS one_open_ticket ON tickets(guild_id,user_id) WHERE status IN ('creating','open')`);
    await this._run(`CREATE TABLE IF NOT EXISTS channel_stats (guild_id TEXT, user_id TEXT, channel_id TEXT, messages INTEGER DEFAULT 0, PRIMARY KEY(guild_id,user_id,channel_id))`);
    await this._run(`CREATE TABLE IF NOT EXISTS daily_stats (day TEXT PRIMARY KEY, messages INTEGER DEFAULT 0, voice_seconds INTEGER DEFAULT 0)`);
    await this._run(`CREATE TABLE IF NOT EXISTS event_rosters (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT, message_id TEXT, name TEXT NOT NULL, capacity INTEGER NOT NULL, creator_id TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT)`);
    await this._run(`CREATE TABLE IF NOT EXISTS event_members (event_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY(event_id,user_id), FOREIGN KEY(event_id) REFERENCES event_rosters(id))`);
    await this._run(`CREATE TABLE IF NOT EXISTS moderation_history (id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT, at TEXT, detail TEXT)`);
    // Additive migrations preserve existing records and old command schemas.
    for (const [table, column, type] of [['aktif_durumlar','guild_id','TEXT'],['aktif_durumlar','reminded','INTEGER DEFAULT 0']]) {
      const columns = await this._query(`PRAGMA table_info(${table})`);
      if (!columns.some(c => c.name === column)) await this._run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    await this._run('PRAGMA user_version = 2');
  }
  async run(sql, params = []) { await this.ready; return this._run(sql, params); }
  async query(sql, params = []) { await this.ready; return this._query(sql, params); }
  async get(sql, params = []) { return (await this.query(sql, params))[0]; }
  async nextCounter(name) {
    return Number((await this.get('UPDATE config SET deger = CAST(deger AS INTEGER) + 1 WHERE anahtar = ? RETURNING deger', [name])).deger);
  }
  async backup() {
    const dir = path.join(this.directory, 'backups');
    fs.mkdirSync(dir, {recursive:true});
    const target = path.join(dir, 'swiz-' + new Date().toISOString().replaceAll(':','-') + '-' + Date.now() + '.db');
    await this.run('VACUUM INTO ?', [target]);
    const entries = fs.readdirSync(dir).filter(n => /^swiz-[\dTZ.:-]+\.db$/.test(n)).sort().reverse();
    for (const name of entries.slice(14)) fs.unlinkSync(path.join(dir, name));
    return target;
  }
  async close() {
    await this.ready;
    return new Promise((resolve,reject) => this.db.close(error => error ? reject(error) : resolve()));
  }
}
module.exports = { DatabaseManager };
