const axios = require('axios');
const { REST, Routes } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const { CONFIG } = require('./config');
const { buildCommands } = require('./commands');
const cache = new Map();
const inflight = new Map();
module.exports = {
  isTargetGuild(id) { return id === CONFIG.GUILD_ID; },
  async loadRuntimeSettings() {
    if(!CONFIG.GUILD_ID || !this.client.guilds.cache.has(CONFIG.GUILD_ID)) throw new Error('GUILD_ID ile belirtilen sunucuya erişilemiyor.');
  },
  async getServerPlayers(url) {
    if(cache.has(url) && Date.now()-cache.get(url).at < 20000) return cache.get(url).players;
    if(inflight.has(url)) return inflight.get(url);
    const pending = (async()=>{
      try {
        const res = await axios.get(url,{timeout:8000,headers:{Accept:'application/json'}});
        const data = res.data.Data || res.data;
        if(!Array.isArray(data.players)) throw new Error('Oyuncu listesi gizli veya veri biçimi beklenenden farklı.');
        cache.set(url,{at:Date.now(),players:data.players});
        return data.players;
      } catch(error) {
        const failure = new Error('FiveM oyuncu listesi şu anda alınamıyor. Sunucu kapalı veya liste gizli olabilir; biraz sonra tekrar dene.');
        failure.publicMessage = failure.message;
        throw failure;
      } finally { inflight.delete(url); }
    })();
    inflight.set(url,pending);
    return pending;
  },
  async recordMessage(message) {
    await this.db.run(`INSERT INTO channel_stats(guild_id,user_id,channel_id,messages) VALUES (?,?,?,1) ON CONFLICT(guild_id,user_id,channel_id) DO UPDATE SET messages=messages+1`,[message.guild.id,message.author.id,message.channel.id]);
    const best = await this.db.get('SELECT channel_id FROM channel_stats WHERE guild_id=? AND user_id=? ORDER BY messages DESC LIMIT 1',[message.guild.id,message.author.id]);
    await this.db.run(`INSERT INTO kullanici_istatistik(kullanici_id,toplam_mesaj,en_aktif_kanal,son_guncelleme) VALUES (?,1,?,?) ON CONFLICT(kullanici_id) DO UPDATE SET toplam_mesaj=toplam_mesaj+1,en_aktif_kanal=excluded.en_aktif_kanal,son_guncelleme=excluded.son_guncelleme`,[message.author.id,best.channel_id,new Date().toISOString()]);
    await this.db.run(`INSERT INTO daily_stats(day,messages) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET messages=messages+1`,[new Date().toISOString().slice(0,10)]);
  },
  async flushVoice(userId) {
    const state = this.voiceSessions.get(userId);
    if(!state) return;
    const now = Date.now(); const seconds = Math.max(0,Math.floor((now-state.at)/1000));
    if(!seconds) return;
    state.at += seconds*1000;
    await this.db.run(`INSERT INTO kullanici_istatistik(kullanici_id,ses_sure,son_guncelleme) VALUES (?,?,?) ON CONFLICT(kullanici_id) DO UPDATE SET ses_sure=ses_sure+excluded.ses_sure,son_guncelleme=excluded.son_guncelleme`,[userId,seconds,new Date().toISOString()]);
    await this.db.run(`INSERT INTO daily_stats(day,voice_seconds) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET voice_seconds=voice_seconds+excluded.voice_seconds`,[new Date().toISOString().slice(0,10),seconds]);
  },
  async recordVoice(oldState,newState) {
    if(!this.isTargetGuild(newState.guild.id) || newState.member?.user.bot) return;
    await this.locks.run(`voice:${newState.id}`,async()=>{
      await this.flushVoice(newState.id);
      if(newState.channelId && newState.channelId !== newState.guild.afkChannelId) this.voiceSessions.set(newState.id,{at:Date.now()});
      else this.voiceSessions.delete(newState.id);
    });
  },
  async beginMetrics() {
    const guild = this.client.guilds.cache.get(CONFIG.GUILD_ID);
    for(const state of guild.voiceStates.cache.values()) if(state.channelId && state.channelId !== guild.afkChannelId && !state.member?.user.bot) this.voiceSessions.set(state.id,{at:Date.now()});
    this.runtimeTimers.add(setInterval(()=>{
      for(const id of this.voiceSessions.keys()) this.locks.run(`voice:${id}`,()=>this.flushVoice(id)).catch(e=>console.error('Ses ölçümü:',e.message));
    },60000));
  },
  scheduleMaintenance() {
    this.runtimeTimers.add(setInterval(()=>this.db.backup().catch(e=>console.error('Yedek:',e.message)),86400000));
  },
  async registerSlashCommands() {
    const rest = new REST({version:'10'}).setToken(CONFIG.TOKEN);
    await rest.put(Routes.applicationCommands(this.client.user.id),{body:buildCommands().map(c=>c.toJSON())});
    console.log(`${buildCommands().length} slash komutu kaydedildi.`);
  },
  async start() {
    if(!CONFIG.TOKEN) throw new Error('DISCORD_TOKEN .env dosyasında tanımlanmalı.');
    if(!CONFIG.GUILD_ID) throw new Error('GUILD_ID .env dosyasında tanımlanmalı.');
    await this.db.ready;
    this.client.on('error',error=>console.error('Discord:',error.message));
    return this.client.login(CONFIG.TOKEN);
  },
  async stop() {
    if(this.stopping) return;
    this.stopping = true;
    for(const timer of [...this.runtimeTimers,...this.aktiflikTimers.values(),...this.maddexTimers.values()]) clearInterval(timer);
    for(const pending of this.confirmations.values()) clearTimeout(pending.timer);
    for(const id of this.voiceSessions.keys()) await this.locks.run(`voice:${id}`,()=>this.flushVoice(id)).catch(()=>{});
    await Promise.allSettled([...this.locks.pending.values()]);
    getVoiceConnection(CONFIG.GUILD_ID)?.destroy();
    this.client.destroy();
    await this.db.close();
  },
};
