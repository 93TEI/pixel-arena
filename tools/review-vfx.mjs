import { chromium } from '@playwright/test';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const root = 'docs/vfx-overhaul';
await mkdir(`${root}/video`, { recursive: true });
const context = await browser.newContext({ viewport:{width:1024,height:900}, recordVideo:{dir:`${root}/video`,size:{width:1024,height:900}} });
const page = await context.newPage();
await page.goto('http://127.0.0.1:5173/vfx-review.html');
await page.waitForFunction(()=>window.__vfxReview?.debug());
for(const species of ['charmander','squirtle']) {
  await page.evaluate(species=>window.__vfxReview.select(species,'special'),species);
  await page.click('#play'); await page.waitForTimeout(3900);
}
const video=page.video(); await context.close(); await copyFile(await video.path(),`${root}/fire-water.webm`);
// Compact native-resolution contact sheet of the actual imported frames, no source-image edits.
const preview=await browser.newPage({viewport:{width:1400,height:1200}});
await preview.goto('http://127.0.0.1:5173/vfx-review.html');
await preview.waitForFunction(()=>window.__vfxReview?.debug());
const html = await preview.evaluate(async()=>{
 const manifest=(await import('/src/render/vfx-manifest.json')).default;
 const keys=['fireBack','fireFront','flame','waterBody','waterSplash','leaf','leafSpin','vine','solarCharge','electricHit','psychicFront','psychicHit'];
 return `<html><meta charset="utf-8"><style>body{background:#26343d;color:white;font:15px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}article{background:#364953;padding:10px;height:255px}canvas{image-rendering:pixelated}h3{margin:0}</style><h1>원본 효과 프레임 · 캐릭터 기준 2.4배</h1><main>${keys.map(k=>`<article><h3>${k}</h3><canvas id="${k}" width="420" height="225"></canvas></article>`).join('')}</main><script>const m=${JSON.stringify(manifest)};for(const key of ${JSON.stringify(keys)}){const clip=m[key],image=new Image();image.src='../../public/assets/vfx/'+clip.file;image.onload=()=>{const c=document.getElementById(key).getContext('2d');c.imageSmoothingEnabled=false;for(let i=0;i<3;i++){const frame=Math.floor((i+1)*clip.columns/4);c.drawImage(image,frame*clip.frameWidth,0,clip.frameWidth,clip.frameHeight,140*i+70-clip.frameWidth*1.2,115-clip.frameHeight*1.2,clip.frameWidth*2.4,clip.frameHeight*2.4);}}}</script></html>`;
});
await writeFile(`${root}/frames.html`,html);
await preview.goto('http://127.0.0.1:5173/docs/vfx-overhaul/frames.html');await preview.waitForTimeout(500);
await preview.screenshot({path:`${root}/frames.png`,fullPage:true});
await preview.goto('file:///Users/tei/pixel-arena/docs/generated-art-review/index.html');
await preview.waitForTimeout(500);await preview.screenshot({path:`${root}/generated-review.png`,fullPage:true});
await preview.goto('http://127.0.0.1:5173/docs/vfx-overhaul/contact.html'); await preview.waitForTimeout(400); await preview.screenshot({path:`${root}/contact.png`,fullPage:true});
await browser.close();
console.log('Saved video, native frame contact sheet, and offline generated-art review.');
