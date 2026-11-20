import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../apps/console/package.json',import.meta.url)),ts=require('typescript');
const source=readFileSync(new URL('../../apps/console/src/lib/listing-evidence.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {isLinkedVariant,evidenceVariants,readableListingNotes,listingColorEvidence}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('historical SKU JSON displays all labelled options and zero inventory without changing input',()=>{
 const rows=[{sku:'RED-S',options:['红色','S'],stock:0,price:99},{sku:'BLUE-L',options:['蓝色','L'],stock:4,price:109}],notes='规格名称：颜色 / 尺码\n\nSKU与规格：'+JSON.stringify(rows);
 const readable=readableListingNotes(notes);assert.match(readable,/SKU：RED-S；颜色：红色；尺码：S；库存：0；售价：99/);assert.match(readable,/SKU：BLUE-L；颜色：蓝色；尺码：L；库存：4；售价：109/);assert.ok(!readable.includes('"options"'));assert.deepEqual(evidenceVariants(JSON.stringify(rows)),rows);assert.ok(notes.includes('"options"'));
});
test('color references and planned prompts never claim successful images or confirmed saleable colors',()=>{
 const job={completed:0,notes:'第1张来源图：可见颜色：灰紫色、深蓝色、浅米色、粉色',facts:[{key:'colors',value:'4 visible colors; availability unconfirmed',sourceId:'notes'}],slots:[{id:'appearance',status:'error',prompt:'Show four colors'}],skipped:['颜色选择：资料不足，已跳过']};
 const display=listingColorEvidence(job);assert.equal(display.visible,true);assert.equal(display.unfinished,true);assert.equal(display.unconfirmed,true);assert.match(display.appearanceStatus,/尚未生成成功/);assert.match(display.colorStatus,/未单独制作/);
 const pending=listingColorEvidence({...job,slots:[{id:'colors',status:'pending'}]});assert.match(pending.colorStatus,/尚未生成成功/);
 const success=listingColorEvidence({...job,completed:1,slots:[{id:'colors',status:'success',imageUrl:'/actual-image'}]});assert.match(success.colorStatus,/^已生成/);assert.equal(success.unfinished,false);
});
test('malformed or unrelated JSON is not treated as a SKU table',()=>{assert.equal(evidenceVariants('{"private":"data"}'),null);assert.equal(evidenceVariants('[{"sku":"X","options":"bad"}]'),null);assert.equal(readableListingNotes('SKU与规格：broken'),'SKU与规格：请返回商品资料核对规格。');});

test('historical numeric FM IDs remain source links instead of asserting a real saleable SKU',()=>{assert.equal(isLinkedVariant({sku:'FM-172001',options:[]}),true);assert.equal(isLinkedVariant({sku:'FM-172001',options:['Red']}),false);assert.equal(isLinkedVariant({sku:'FM-REAL',options:[]}),false);assert.match(readableListingNotes('SKU与规格：[{\"sku\":\"FM-172001\",\"options\":[]}]'),/来源关联标识.*未提供实际可售规格/);});
