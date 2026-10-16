import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const tag = process.argv[2] ?? 'after';
const root = `docs/vfx-overhaul/${tag}`;
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(() => window.__arena?.getFrames()?.length);
await page.addStyleTag({content:'[data-status-overlay],[data-select-overlay] { opacity:0!important; pointer-events:none!important }'});
const report = [];
for (const species of ['charmander', 'squirtle', 'bulbasaur', 'ivysaur', 'pikachu', 'mewtwo']) {
  await page.evaluate(species => {
    const api = window.__arena; api.start(species); api.setPaused(true);
    const s=api.getState(); s.obstacles=[]; s.fighters[0].pos={x:330,y:340}; s.fighters[1].pos={x:575,y:340};
    const idle={move:{x:0,y:0},melee:false,ranged:false,dodge:false}; api.setState(s);
    for(let i=0;i<65;i++) api.step([{...idle,special:i===0},idle],1/60);
  },species);
  await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.locator('canvas').screenshot({path:`${root}/${species}-special.png`});
  report.push(await page.evaluate(()=>({species:window.__arena.getState().fighters[0].species,effects:window.__arena.getVfx?.()})));
}
// Identical static stress scene before/after; measure browser frame delivery, not a GPU benchmark.
await page.evaluate(()=>{const api=window.__arena,s=api.getState();s.winner=null;s.effects=[];s.time=1;
 s.hazards=['charmander','squirtle','pikachu','mewtwo'].map((species,i)=>({id:i+200,owner:i%2,species,pos:{x:260+i*140,y:360},radius:70,life:1.4,maxLife:2.85,warmup:0,damageTimer:.2}));
 s.beams=['charmander','squirtle','pikachu','mewtwo'].map((species,i)=>({owner:i%2,species,start:{x:160,y:140+i*60},end:{x:800,y:140+i*60},width:14,power:1,blocked:true}));api.setState(s);});
await page.locator('canvas').screenshot({path:`${root}/stress.png`});
// Match the original baseline's visible selection overlay during timing only.
await page.addStyleTag({content:'[data-select-overlay] { opacity:1!important; pointer-events:none!important }'});
const perf = await page.evaluate(async()=>{const times=[];let prev=performance.now();for(let i=0;i<120;i++) await new Promise(r=>requestAnimationFrame(t=>{times.push(t-prev);prev=t;r();}));times.sort((a,b)=>a-b);return {median:times[60],p95:times[114],vfx:window.__arena.getVfx?.()};});
await writeFile(`${root}/report.json`,JSON.stringify({report,perf,timingScene:'Four areas and four beams; selection overlay visible, matching the original before timing capture.'},null,2));
console.log(JSON.stringify({tag,median:perf.median,p95:perf.p95,active:perf.vfx?.active,allocated:perf.vfx?.allocated,renderMs:perf.vfx?.renderMs}));
await browser.close();
