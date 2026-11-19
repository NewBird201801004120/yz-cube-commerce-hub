import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ListingService} from '../src/listing';
test('listing requires a nonblank product name before task creation or any AI work',async()=>{
 for(const name of [undefined,null,'','   ','\n\t',123,{}]){
  let reachedWork=false;const service:any={createNew:()=>{reachedWork=true;throw Error('must not create');}};
  await assert.rejects(()=>ListingService.prototype.create.call(service,{name},'operator'),/请填写产品名称/);assert.equal(reachedWork,false);
 }
});
