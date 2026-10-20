const {spawnSync} = require('node:child_process'); const fs=require('node:fs');
const input=JSON.parse(fs.readFileSync('database/seeds/demo.json','utf8')); Object.assign(input,{protocolVersion:'1.0',dataSnapshotVersion:'demo-v1',hardConstraints:[],softConstraints:[],unavailableSlots:[],lockedEntries:[],timeLimitSeconds:30,randomSeed:1});
const p=spawnSync('python',['services/solver/solver.py'],{input:JSON.stringify(input),encoding:'utf8'}); if(p.error) throw p.error; console.log(p.stdout); if(p.status!==0) process.exit(p.status);
