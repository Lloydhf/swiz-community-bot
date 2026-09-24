const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { SwizBot } = require('../src/bot');
const { CONFIG } = require('../src/config');
// Distinct synthetic IDs keep the member-role tests independent of local settings.
for (const key of Object.keys(CONFIG.IDS)) CONFIG.IDS[key] = `test-${key}`;
CONFIG.GUILD_ID = 'test-guild';

function member(id, { status = 'online', bot = false, friend = false, swiz = true } = {}) {
    const roles = [];
    if (swiz) roles.push([CONFIG.IDS.SWIZ_ROL, {}]);
    if (friend) roles.push([CONFIG.IDS.DOST_ROL, {}]);
    return {
        id, displayName: `Üye ${id}`,
        user: { bot, username: `user${id}`, toString: () => `<@${id}>` },
        roles: { cache: new Collection(roles) }, presence: { status },
    };
}

function setup(members) {
    const steps = [];
    const bot = Object.create(SwizBot.prototype);
    const source = {
        guild: { id: CONFIG.GUILD_ID, members: {
            cache: new Collection(members.map(m => [m.id, m])),
            fetch: async () => { steps.push('fetch'); },
        } },
        commandName: 'aktif', deferred: false, replied: false,
        isChatInputCommand: () => true, isButton: () => false, isCommand: () => true,
        deferReply: async () => { steps.push('defer'); source.deferred = true; },
        reply: async payload => { steps.push('reply'); source.output = payload; },
        editReply: async payload => { steps.push('edit'); source.output = payload; },
        followUp: async payload => { steps.push('followUp'); source.output = payload; },
        channel: { send: async payload => { steps.push('send'); source.output = payload; } },
    };
    return { bot, source, steps };
}

test('/aktif acknowledges before fetching and preserves member filters', async () => {
    const { bot, source, steps } = setup([
        member('1'), member('2', { status: 'idle' }), member('3', { status: 'dnd' }),
        member('4', { status: 'offline' }), member('5', { bot: true }),
        member('6', { friend: true }), member('7', { swiz: false }),
    ]);
    await bot.processAktifCommand(source, true);
    assert.deepEqual(steps, ['defer', 'fetch', 'edit']);
    const description = source.output.embeds[0].toJSON().description;
    assert.match(description, /3 aktif Swiz/);
    for (const id of ['1', '2', '3']) assert.ok(description.includes(`<@${id}>`));
    for (const id of ['4', '5', '6', '7']) assert.ok(!description.includes(`<@${id}>`));
    assert.deepEqual(source.output.files, []);
});

test('Large active lists fit the embed limit and keep every member in the attachment', async () => {
    const members = Array.from({ length: 400 }, (_, i) => member(String(100000000000000000n + BigInt(i))));
    const { bot, source } = setup(members);
    await bot.processAktifCommand(source, true);
    const description = source.output.embeds[0].toJSON().description;
    assert.ok(description.length <= 4096);
    assert.match(description, /400 aktif Swiz/);
    assert.equal(source.output.files.length, 1);
    const fullList = source.output.files[0].attachment.toString('utf8');
    for (const m of members) assert.ok(fullList.includes(`(${m.id})`));
    assert.equal(fullList.split('\n').length, 402);
});

test('!aktif still sends an empty result to the channel without interaction methods', async () => {
    const { bot, source, steps } = setup([]);
    delete source.deferReply;
    await bot.processAktifCommand(source, false);
    assert.deepEqual(steps, ['fetch', 'send']);
    assert.match(source.output.embeds[0].toJSON().description, /Henüz aktif Swiz üyesi yok/);
});

test('A failed member fetch resolves the deferred interaction with an error', async t => {
    const { bot, source, steps } = setup([]);
    source.guild.members.fetch = async () => { throw new Error('Simulated unavailable member list'); };
    t.mock.method(console, 'error', () => {});
    await bot.onInteractionCreate(source);
    assert.deepEqual(steps, ['defer', 'edit']);
    assert.match(source.output.content, /İşlem tamamlanamadı/);
});
