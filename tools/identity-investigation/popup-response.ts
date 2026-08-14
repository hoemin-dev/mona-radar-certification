import { chromium } from "playwright";
const url="https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do";
const browser=await chromium.launch({headless:true});const context=await browser.newContext({locale:"ko-KR"});const page=await context.newPage();
const bodies:Array<{url:string,type:string,terms:Record<string,number>}>=[];const pending:Promise<void>[]=[];
page.on("response",response=>{const type=response.request().resourceType();if(!["document","script"].includes(type))return;
  pending.push(response.text().then(text=>{const terms=Object.fromEntries(["seqNo","crtfcSeCode","SelectTdPrdVw.do","fn_selectTdprdVw","searchDetailPrdnm"].map(t=>[t,text.split(t).length-1]));
    if(type==="document"||Object.values(terms).some(n=>n>0))bodies.push({url:response.url(),type,terms});}).catch(()=>{}));});
await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
await page.locator("#prdSearch").click();await page.waitForTimeout(1500);
const frame=page.frames().find(f=>f.url().includes("SelectSmlpzBtwnCmptprdSearchVwP"));
const popup=frame?await frame.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText.slice(0,5000),
  forms:[...document.forms].map(f=>({name:f.name,method:f.method,action:f.action,controls:[...f.elements].map((e:any)=>({tag:e.tagName,type:e.type,name:e.name,id:e.id,value:e.value,onclick:e.getAttribute?.("onclick")}))})),
  links:[...document.querySelectorAll("a")].slice(0,30).map(a=>({text:a.textContent?.trim(),href:a.getAttribute("href"),onclick:a.getAttribute("onclick")})),
  scripts:[...document.scripts].map(s=>({src:s.src,terms:Object.fromEntries(["callback","PopCallback","detailPrdnm","prdNmNo"].map(t=>[t,(s.textContent??"").split(t).length-1]))})).filter(x=>Object.values(x.terms).some((n:any)=>n>0))
})):null;
await Promise.allSettled(pending);console.log(JSON.stringify({responseEvidence:bodies,popup},null,2));await browser.close();
