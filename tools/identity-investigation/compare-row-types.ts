import { DatabaseSync } from "node:sqlite";
const db=new DatabaseSync("collector/data/mona-radar-certification.sqlite",{readOnly:true});
const types=["NET","NEP","성능인증","우수조달물품","GS","녹색기술제품","우수조달공동상표","산업융합품목"];
const result=types.map(type=>{const row=db.prepare("SELECT source_row_no,raw_json FROM certification_records WHERE run_id=8 AND certification_type=? LIMIT 1").get(type) as any;
  const raw=JSON.parse(row.raw_json),html=String(raw.rowHtml);return{type,sourceRowNo:row.source_row_no,
    linkCount:(html.match(/<a\b/gi)||[]).length,onclickCount:(html.match(/onclick=/gi)||[]).length,
    seqNo:/seqNo/i.test(html),crtfcSeCode:/crtfcSeCode/i.test(html),dataAttributes:[...html.matchAll(/\s(data-[\w-]+)=/gi)].map(m=>m[1]),
    imageSrc:raw.imageSrc};});console.log(JSON.stringify(result,null,2));db.close();
