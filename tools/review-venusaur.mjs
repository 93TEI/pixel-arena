import { chromium } from '@playwright/test';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
const root='docs/pokemon/0003-venusaur';await mkdir(`${root}/video`,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
if (!process.argv.includes('--performance')) {
const context=await browser.newContext({viewport:{width:1100,height:850},recordVideo:{dir:`${root}/video`,size:{width:1100,height:850}}});const page=await context.newPage();
await page.goto('http://127.0.0.1:5173/vfx-review.html');await page.waitForFunction(()=>window.__vfxReview?.debug());
const reports=[];
for(const [move,tick] of [['melee',22],['ranged',55],['special',65]]) {
 await page.evaluate(move=>window.__vfxReview.select('venusaur',move,'mastery'),move);await page.evaluate(n=>window.__vfxReview.seek(n),tick);
 await page.screenshot({path:`${root}/${move}.png`,fullPage:true});reports.push({move,tick,debug:await page.evaluate(()=>window.__vfxReview.debug())});
 await page.click('#restart');await page.click('#play');await page.waitForTimeout(2300);await page.click('#play');
}
await writeFile(`${root}/vfx-report.json`,JSON.stringify(reports,null,2));const video=page.video();await context.close();await copyFile(await video.path(),`${root}/skills.webm`);
for(const viewport of [{width:844,height:390},{width:390,height:844},{width:320,height:740}]){
 const page=await browser.newPage({viewport});await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.__arena?.getFrames());await page.screenshot({path:`${root}/roster-${viewport.width}.png`,fullPage:true});
 console.log(JSON.stringify({viewport,layout:await page.evaluate(()=>({stage:document.querySelector('.game-stage').getBoundingClientRect().toJSON(),opponent:document.querySelector('[data-opponent]').getBoundingClientRect().toJSON(),cards:[...document.querySelectorAll('[data-species]')].map(e=>({species:e.dataset.species,rect:e.getBoundingClientRect().toJSON()}))}))}));await page.close();
}
}
const perfPage=await browser.newPage({viewport:{width:1280,height:900}});
await perfPage.goto('http://127.0.0.1:5173/');await perfPage.waitForFunction(()=>window.__arena?.getFrames());
await perfPage.evaluate(()=>{
 const api=window.__arena;api.start('venusaur','venusaur');api.setPaused(true);
 const s=api.getState();s.obstacles=[];api.setState(s);
 const idle={move:{x:0,y:0},melee:false,ranged:false,dodge:false};
 for(let i=0;i<66;i++)api.step([{...idle,special:i===0},{...idle,special:i===0}],1/60);
 const next=api.getState();window.reviewPlants=structuredClone(next.plantAttacks);next.plantAttacks=[];next.effects=[];next.time=1;
 next.hazards=['charmander','squirtle','pikachu','mewtwo'].map((species,i)=>({id:i+200,owner:i%2,species,pos:{x:260+i*140,y:360},radius:70,life:1.4,maxLife:2.85,warmup:0,damageTimer:.2}));
 next.beams=['charmander','squirtle','pikachu','mewtwo'].map((species,i)=>({owner:i%2,species,start:{x:160,y:140+i*60},end:{x:800,y:140+i*60},width:14,power:1,blocked:true}));api.setState(next);
});
const perf=[];
for(const extra of [false,true]){
 if(extra)await perfPage.evaluate(()=>{const a=window.__arena,s=a.getState();s.plantAttacks=window.reviewPlants;a.setState(s);});
 const timing=await perfPage.evaluate(async()=>{const times=[];let prev=performance.now();for(let i=0;i<120;i++)await new Promise(r=>requestAnimationFrame(t=>{times.push(t-prev);prev=t;r();}));times.sort((a,b)=>a-b);const v=window.__arena.getVfx();return{median:times[60],p95:times[114],active:v.active,allocated:v.allocated,renderMs:v.renderMs,missing:v.missing};});
 perf.push({scene:extra?'four areas + four beams + two root waves':'four areas + four beams',...timing});
}
await writeFile(`${root}/performance.json`,JSON.stringify({caveat:'120 rAF intervals per static scene, Chromium default headless rendering, visible selection overlay. Local comparison only; not a mobile performance guarantee.',perf},null,2));console.log(JSON.stringify({perf}));
await browser.close();
