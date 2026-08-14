import { chromium } from "playwright";
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
await page.goto("https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do",{waitUntil:"domcontentloaded",timeout:90000});
const result=await page.evaluate(()=>{const rows=[...document.querySelectorAll('tr:has(td[data-label="인증구분"])')];return{
  mobileYn:(document.querySelector('[name="mobileYn"]') as HTMLInputElement)?.value,
  detailCalls:[...document.querySelectorAll("[onclick]")].map(e=>e.getAttribute("onclick")).filter(x=>x?.includes("fn_selectTdprdVw")),
  rowCount:rows.length,rowLinkCounts:rows.slice(0,5).map(r=>r.querySelectorAll("a").length),
  seqInRows:rows.some(r=>/seqNo|crtfcSeCode/i.test(r.outerHTML)),firstRowHtml:rows[0]?.outerHTML.slice(0,1800)};});
console.log(JSON.stringify(result,null,2));await browser.close();
