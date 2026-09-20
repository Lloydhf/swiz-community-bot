const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');let failed=false;let count=0;
function check(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','backups'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())check(file);else if(file.endsWith('.js')){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});count++;if(result.status){failed=true;console.error(result.stderr);}}}}
check(root);require('../src/commands').buildCommands().forEach(c=>c.toJSON());console.log(`${count} JavaScript dosyası ve komut tanımları kontrol edildi.`);process.exitCode=failed?1:0;
