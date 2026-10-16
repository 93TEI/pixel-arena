import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const result = await build({ stdin: { contents: "export {createBattle,stepBattle} from './src/game/battle';export {aiCommand} from './src/game/ai'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const {createBattle,stepBattle,aiCommand}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const count=Number(process.argv[2]??100);
if(!Number.isInteger(count)||count<1||count>1000)throw Error('Seeds must be 1..1000');
const reports=[];
for(const opponent of ['bulbasaur','ivysaur','charmander','squirtle','pikachu','mewtwo','venusaur']){
 let wins=0,draws=0,hpLost=0,time=0;const bySide=[0,0];
 for(let seed=1;seed<=count;seed++)for(const slot of [0,1]){
  const s=createBattle(slot?opponent:'venusaur',seed,slot?'venusaur':opponent);
  for(let tick=0;tick<5400&&s.winner===null;tick++)stepBattle(s,[aiCommand(s,0,1/60),aiCommand(s,1,1/60)],1/60);
  if(s.winner===slot){wins++;bySide[slot]++;}if(s.winner===null)draws++;
  hpLost+=100-s.fighters[1-slot].hp;time+=s.time;
 }
 const row={opponent,matches:count*2,wins,draws,winRate:wins/(count*2),bySide:bySide.map(n=>n/count),meanOpponentHPLost:hpLost/(count*2),meanSeconds:time/(count*2)};
 reports.push(row);console.log(JSON.stringify(row));
}
const pairs=reports.filter(r=>r.opponent!=='venusaur'), winRate=pairs.reduce((n,r)=>n+r.wins,0)/pairs.reduce((n,r)=>n+r.matches,0);
const report={date:new Date().toISOString(),seedCount:count,seeds:`1..${count}`,limitSeconds:90,caveat:'AI is deterministic and seed % 31 repeats tactics. Not independent trials or evidence of human balance. Mirror is excluded from overall.',summary:{winRate,overallTargetMet:winRate>=.45&&winRate<=.55,pairTargetMet:pairs.every(r=>r.winRate>=.35&&r.winRate<=.65)},reports};
await mkdir('docs/pokemon/0003-venusaur',{recursive:true});await writeFile('docs/pokemon/0003-venusaur/balance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
