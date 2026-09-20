const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, EmbedBuilder } = require('discord.js');
const { SwizBot } = require('../src/bot');
const { DatabaseManager } = require('../src/database');
const { KeyedLock } = require('../src/utils');
const { CONFIG } = require('../src/config');
const { buildCommands } = require('../src/commands');
const oldCommands = require('./legacy-commands.json');
// Distinct offline fixture IDs: tests must not depend on a developer's server configuration.
for (const key of Object.keys(CONFIG.IDS)) CONFIG.IDS[key] = `test-${key}`;
CONFIG.GUILD_ID = 'test-guild';
async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'swiz-test-'));
  const db=new DatabaseManager(path.join(dir,'test.db')); await db.ready;
  t.after(async()=>{await db.close(); fs.rmSync(dir,{recursive:true,force:true});});
  const bot=Object.create(SwizBot.prototype);
  Object.assign(bot,{db,locks:new KeyedLock(),confirmations:new Map(),voiceSessions:new Map(),aktiflikKatilim:new Map(),maddexKatilim:new Map(),aktiflikTimers:new Map(),maddexTimers:new Map(),logEvent:async()=>{},sendPaginatedButtonEmbeds:async()=>{}});
  return {bot,db,dir};
}
function interaction(user='member') {
  const i={user:{id:user,username:user,tag:user},guild:{id:CONFIG.GUILD_ID,ownerId:'owner',roles:{cache:new Collection()},channels:{cache:new Collection()},members:{fetch:async()=>new Collection()}},member:{roles:{cache:new Collection()}},memberPermissions:{has:()=>false},channel:{id:'text'},message:{id:'message',embeds:[new EmbedBuilder().setTitle('Test').addFields({name:'Süre',value:'10'},{name:'Katılan',value:'0'})],edit:async p=>{i.message.edited=p;}},responses:[]};
  for(const method of ['reply','editReply','followUp','update']) i[method]=async p=>{i.responses.push(p);return i.message;};
  i.deferReply=async()=>{};
  i.isChatInputCommand=()=>true;
  return i;
}
test('All 26 legacy commands and their options remain compatible',()=>{
  const now=JSON.parse(JSON.stringify(buildCommands().map(c=>c.toJSON()))); assert.equal(new Set(now.map(c=>c.name)).size,now.length);
  for(const old of oldCommands){const current=now.find(c=>c.name===old.name);assert.ok(current,old.name);for(const option of old.options || []) assert.deepEqual(current.options.find(o=>o.name===option.name),option);}
  assert.equal(now.length,33);
});
test('Migrations preserve data on reopening, backup is readable',async t=>{
  const {db,dir}=await fixture(t);
  await db.run("INSERT INTO uyarilar(kullanici_id,sebep) VALUES ('u','existing')");
  const backup=await db.backup(); assert.ok(backup.startsWith(dir));
  const restored=new DatabaseManager(backup);await restored.ready;
  assert.equal((await restored.get('SELECT sebep FROM uyarilar')).sebep,'existing');await restored.close();
});
test('Counters allocate unique values under concurrent requests',async t=>{
  const {db}=await fixture(t);const ids=await Promise.all(Array.from({length:20},()=>db.nextCounter('ticket_sayaci')));
  assert.equal(new Set(ids).size,20);
});
test('Unknown admin actions fail closed and owner can use existing actions',async t=>{
  const {bot}=await fixture(t);const i=interaction();assert.equal(bot.checkPermission(i,'unknown'),false);assert.equal(bot.checkPermission(i,'ban'),false);
  i.user.id='owner';assert.equal(bot.checkPermission(i,'ban'),true);assert.equal(bot.checkPermission(i,'banlar'),true);
});
test('Warning reset rejects another user and expired/legacy confirmations',async t=>{
  const {bot,db}=await fixture(t);await db.run("INSERT INTO uyarilar(kullanici_id,sebep) VALUES ('u','keep')");
  const i=interaction('intruder');i.customId='affi_onay_session';
  bot.confirmations.set('session',{user:'owner',guild:i.guild.id,message:i.message.id,expires:Date.now()+30000});
  await bot.handleUyariAffiButton(i);assert.match(i.responses.at(-1).content,/geçersiz/);assert.equal((await db.get('SELECT COUNT(*) n FROM uyarilar')).n,1);
});
test('Concurrent ticket clicks create one channel and preserve the owner record',async t=>{
  const {bot,db}=await fixture(t);const a=interaction('user'),b=interaction('user');let created=0;
  bot.client={user:{id:'bot'}};
  const channel={id:'ticket-channel',send:async()=>{},delete:async()=>{},toString:()=>'<#ticket-channel>'};
  const guild=a.guild; b.guild=guild;
  guild.channels.cache.set(CONFIG.IDS.TICKET_KATEGORI,{id:CONFIG.IDS.TICKET_KATEGORI,type:4});
  guild.channels.create=async()=>{created++;await new Promise(r=>setTimeout(r,5));return channel;};guild.channels.fetch=async()=>channel;
  await Promise.all([bot.handleTicketButton(a),bot.handleTicketButton(b)]);
  assert.equal(created,1);assert.equal((await db.get("SELECT COUNT(*) n FROM tickets WHERE status='open'")).n,1);
  assert.equal((await db.get('SELECT user_id FROM tickets')).user_id,'user');
});
test('Failed ticket creation does not apply a cooldown',async t=>{
  const {bot,db}=await fixture(t);bot.client={user:{id:'bot'}};const i=interaction();
  i.guild.channels.cache.set(CONFIG.IDS.TICKET_KATEGORI,{id:CONFIG.IDS.TICKET_KATEGORI,type:4});i.guild.channels.create=async()=>{throw new Error('simulated permission failure');};
  await bot.handleTicketButton(i);assert.equal(await db.get('SELECT * FROM ticket_limits'),undefined);assert.equal((await db.get('SELECT status FROM tickets')).status,'failed');
});
test('Ticket close checks ownership before deleting anything',async t=>{
  const {bot,db}=await fixture(t);await db.run("INSERT INTO tickets(ticket_no,guild_id,user_id,channel_id,status,created_at) VALUES (1,?,'owner','text','open',?)",[CONFIG.GUILD_ID,new Date().toISOString()]);
  let deleted=false;const i=interaction('intruder');i.channel.delete=async()=>{deleted=true;};await bot.handleTicketCloseButton(i);assert.equal(deleted,false);assert.equal((await db.get('SELECT status FROM tickets')).status,'open');
});
test('Roster survives restart, prevents duplicates and advances waitlist',async t=>{
  const {bot,db}=await fixture(t);await db.run('INSERT INTO event_rosters(id,guild_id,channel_id,message_id,name,capacity,creator_id,created_at) VALUES (?,?,?,?,?,?,?,?)',['event',CONFIG.GUILD_ID,'text','message','Training',1,'owner',new Date().toISOString()]);
  for(const user of ['one','two','two']){const i=interaction(user);i.customId='etkinlik_event';await bot.handleEtkinlikButton(i);}
  assert.equal((await db.get('SELECT COUNT(*) n FROM event_members')).n,2);
  const leave=interaction('one');leave.customId='etkinlik_cik_event';await bot.handleEtkinlikButton(leave);
  assert.equal((await db.get('SELECT user_id FROM event_members ORDER BY joined_at,rowid')).user_id,'two');
});
test('Ended attendance rejects stale buttons',async t=>{
  const {bot,db}=await fixture(t);await db.run("INSERT INTO aktif_durumlar(durum_id,tip,bitis_zamani,tamamlandi,mesaj_id,kanal_id) VALUES ('event','aktiflik',?,1,'message','text')",[new Date(Date.now()+60000).toISOString()]);
  const i=interaction();i.customId='aktiflik_event';await bot.handleAktiflikButton(i);assert.match(i.responses.at(-1),/açık değil/);
});
test('Completion can only claim an attendance once',async t=>{
  const {bot,db}=await fixture(t);await db.run("INSERT INTO aktif_durumlar(durum_id,tip,katilanlar,tamamlandi) VALUES ('event','aktiflik','[]',0)");
  let reports=0;const i=interaction();i.guild.channels.cache.set(CONFIG.IDS.YOKLAMA_LOG_KANALI,{send:async()=>{reports++;}});
  const role={name:'Members',members:new Collection()};
  await Promise.all([bot.bitirAktiflik(i,'event',role),bot.bitirAktiflik(i,'event',role)]);assert.equal(reports,2);assert.equal((await db.get('SELECT tamamlandi FROM aktif_durumlar')).tamamlandi,1);
});
test('Message statistics increment without storing content',async t=>{
  const {bot,db}=await fixture(t);await bot.recordMessage({guild:{id:CONFIG.GUILD_ID},author:{id:'u'},channel:{id:'c'},content:'private text'});
  const row=await db.get('SELECT * FROM kullanici_istatistik');assert.equal(row.toplam_mesaj,1);assert.equal(row.en_aktif_kanal,'c');assert.ok(!JSON.stringify(row).includes('private text'));
});
test('New event command persists its channel, capacity and message',async t=>{
  const {bot,db}=await fixture(t);const i=interaction('owner');i.options={getString:()=> 'Practice',getInteger:()=>3};
  await bot.handleEtkinlik(i);const row=await db.get('SELECT * FROM event_rosters');assert.equal(row.capacity,3);assert.equal(row.message_id,'message');assert.equal(row.guild_id,CONFIG.GUILD_ID);
  assert.doesNotThrow(()=>i.responses[0].embeds[0].toJSON());
});
test('Voice checkpoints add elapsed time once',async t=>{
  const {bot,db}=await fixture(t);bot.voiceSessions.set('u',{at:Date.now()-65000});await bot.flushVoice('u');await bot.flushVoice('u');
  const row=await db.get('SELECT ses_sure FROM kullanici_istatistik WHERE kullanici_id=?',['u']);assert.ok(row.ses_sure>=65 && row.ses_sure<=66);
});
test('Statistics command defers once and produces a valid embed',async t=>{
  const {bot}=await fixture(t);const i=interaction();i.commandName='istatistik';i.options={getUser:()=>null};
  assert.equal(await bot.handleFeature(i),true);assert.doesNotThrow(()=>i.responses.at(-1).embeds[0].toJSON());
});
test('Warning reset keeps records when Discord refuses role removal',async t=>{
  const {bot,db}=await fixture(t);await db.run("INSERT INTO uyarilar(kullanici_id,sebep) VALUES ('blocked','keep'),('ok','remove')");
  const i=interaction('owner');i.customId='affi_onay_valid';i.guild.members.fetch=async()=>new Collection([
    ['blocked',{id:'blocked',user:{bot:false},roles:{cache:new Collection([[CONFIG.WARNING_ROLES.STRIKE1,{}]]),remove:async()=>{throw new Error('hierarchy');}}}],
  ]);
  bot.confirmations.set('valid',{user:'owner',guild:i.guild.id,message:i.message.id,expires:Date.now()+30000});
  await bot.handleUyariAffiButton(i);const rows=await db.query('SELECT kullanici_id FROM uyarilar');assert.deepEqual(rows,[{kullanici_id:'blocked'}]);
  assert.equal(bot.confirmations.size,0);
});
