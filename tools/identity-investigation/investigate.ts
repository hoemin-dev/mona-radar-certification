import { chromium, type Request } from "playwright";

const url="https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do";
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:"ko-KR",timezoneId:"Asia/Seoul"});
const page=await context.newPage();
const requests:Array<Record<string,unknown>>=[];
const relevant=(request:Request)=>request.isNavigationRequest()||/TdPrd|DetailPrdnm|prdNm|goods/i.test(request.url());
page.on("request",request=>{if(relevant(request))requests.push({method:request.method(),url:request.url(),resourceType:request.resourceType(),postData:request.postData()});});
await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
const initial=await page.evaluate(()=>({
  forms:[...document.forms].map(f=>({name:f.name,id:f.id,method:f.method,action:f.action,
    controls:[...f.elements].map((e:any)=>({tag:e.tagName,type:e.type,name:e.name,id:e.id,value:e.value,checked:e.checked})).filter((x:any)=>/seq|crtfc|prd|entrps|bsnm|detail|code|id/i.test(`${x.name} ${x.id}`))})),
  scripts:[...document.scripts].map(s=>s.src).filter(Boolean),
  detailCalls:[...document.querySelectorAll("[onclick]")].map(e=>e.getAttribute("onclick")).filter(x=>x?.includes("fn_selectTdprdVw")),
  relevantHtmlMatches:[...document.documentElement.outerHTML.matchAll(/.{0,100}(?:seqNo|crtfcSeCode|SelectTdPrdVw\.do|fn_selectTdprdVw|searchBsnmNo|searchDetailPrdnmNo).{0,180}/gi)].map(m=>m[0]).slice(0,80),
  resultRows:[...document.querySelectorAll('tr:has(td[data-label="인증구분"])')].slice(0,3).map(r=>r.outerHTML),
}));
if(!await page.locator("#searchOverDateYn").isChecked())await page.locator('label[for="searchOverDateYn"]').click();
await Promise.all([page.waitForNavigation({waitUntil:"domcontentloaded",timeout:90000}),page.locator("#search").click()]);
const afterSearch=await page.evaluate(()=>({
  expired:(document.querySelector("#searchOverDateYn") as HTMLInputElement)?.checked,
  detailCalls:[...document.querySelectorAll("[onclick]")].map(e=>e.getAttribute("onclick")).filter(x=>x?.includes("fn_selectTdprdVw")),
  seqValues:[...document.querySelectorAll('input[name="seqNo"]')].map((e:any)=>e.value),
  codeValues:[...document.querySelectorAll('input[name="crtfcSeCode"]')].map((e:any)=>e.value),
}));
let popup:unknown={error:"not attempted"};
try{
  await page.locator("#prdSearch").click();
  await page.waitForTimeout(1500);
  popup={frames:page.frames().map(f=>({url:f.url(),name:f.name()})),html:await page.locator("body").innerText().then(x=>x.slice(-4000))};
}catch(error){popup={error:error instanceof Error?error.message:String(error)};}
console.log(JSON.stringify({initial,afterSearch,requests,popup},null,2));
await browser.close();
