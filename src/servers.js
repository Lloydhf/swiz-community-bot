const FIVEM_SERVERS = [
    { name: 'Alesta RP', url: 'https://frontend.cfx-services.net/api/servers/single/gm3g4q', short: 'alesta' },
    { name: 'GUID PVP', url: 'https://frontend.cfx-services.net/api/servers/single/zem7ky', short: 'guid' },
    { name: 'MD PVP', url: 'https://frontend.cfx-services.net/api/servers/single/z5gxl9', short: 'mdpvp' },
    { name: 'FAVE PVP', url: 'https://frontend.cfx-services.net/api/servers/single/7re69a', short: 'fave' },
    { name: 'MD RP', url: 'https://frontend.cfx-services.net/api/servers/single/xjx5kr', short: 'md' },
    { name: 'GUN PVP', url: 'https://frontend.cfx-services.net/api/servers/single/qqa5q44', short: 'gunpvp' },
    { name: 'WELL GUN', url: 'https://frontend.cfx-services.net/api/servers/single/8emv3b3', short: 'well' },
    { name: 'WILDGUN', url: 'https://frontend.cfx-services.net/api/servers/single/xlz6llm', short: 'wild' },
    { name: 'FXGUN', url: 'https://frontend.cfx-services.net/api/servers/single/e6e46kb', short: 'fxgun' },
    { name: 'LOLPVP', url: 'https://frontend.cfx-services.net/api/servers/single/98yg57e', short: 'lolpvp' },
    { name: 'PGUN', url: 'https://frontend.cfx-services.net/api/servers/single/dg3k3rd', short: 'project' }
];
const SERVER_SHORTCUTS = Object.fromEntries(FIVEM_SERVERS.map(s => [s.short, s]));
module.exports = { FIVEM_SERVERS, SERVER_SHORTCUTS };
