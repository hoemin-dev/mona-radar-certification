import { chromium } from "playwright";
const browser=await chromium.launch({headless:true});const page=await browser.newPage();let postData:string|null=null;
page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("SelectTdPrdListVw.do"))postData=r.postData();});
await page.goto("https://www.smpp.go.kr/prd/prdinfo/tdprd/SelectTdPrdListVw.do",{waitUntil:"domcontentloaded",timeout:90000});
await page.locator("#prdSearch").click();await page.waitForTimeout(700);const frame=page.frames().find(f=>f.url().includes("SelectSmlpzBtwnCmptprdSearchVwP"));
if(!frame)throw new Error("popup frame missing");await frame.getByText("석회질비료",{exact:true}).first().click();await page.waitForTimeout(500);
const selected=await page.evaluate(()=>({code:(document.querySelector("#searchDetailPrdnmNo") as HTMLInputElement).value,name:(document.querySelector("#searchDetailPrdnm") as HTMLInputElement).value}));
if(!await page.locator("#searchOverDateYn").isChecked())await page.locator('label[for="searchOverDateYn"]').click();
await Promise.all([page.waitForNavigation({waitUntil:"domcontentloaded",timeout:90000}),page.locator("#search").click()]);
const result=await page.evaluate(()=>({total:[...document.querySelectorAll("p")].map(p=>p.textContent?.trim()).find(x=>x?.startsWith("전체 ")),
  code:(document.querySelector("#searchDetailPrdnmNo") as HTMLInputElement).value,name:(document.querySelector("#searchDetailPrdnm") as HTMLInputElement).value,
  rows:[...document.querySelectorAll('tr:has(td[data-label="인증구분"])')].map(r=>r.outerHTML),
}));console.log(JSON.stringify({selected,postData,result:{...result,rowsContainCode:result.rows.some(x=>x.includes(selected.code)),rowsContainName:result.rows.some(x=>x.includes(selected.name)),rowCount:result.rows.length}},null,2));
await browser.close();
