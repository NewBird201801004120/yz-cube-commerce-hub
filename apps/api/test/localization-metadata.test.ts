import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalizationPlatform} from '../src/localization-platform';
import type {LocalizationDraft} from '../src/localization-engine';
const owner='operator@example.test',shop={id:'shop',shopId:'123',shopName:'Fixture',region:'PH',status:'CONNECTED'};
const draft=():LocalizationDraft=>({id:'draft',owner,sourceId:'source',revision:1,shop:{...shop,currency:'PHP',language:'English'},language:'English',title:'Silicone kitchen utensil set',sellingPoints:[],description:'Kitchen utensils',specificationNames:[],variants:[{sku:'A',options:[],price:100,stock:1}],weightKg:.722,dimensionsCm:{length:30,width:15,height:10},categoryId:5,brandId:0,attributes:[],logistics:[{id:9,enabled:true}],images:['https://cdn.example.com/a.jpg'],marketConfirmed:false,imagesReviewed:false,createdAt:'',updatedAt:''});
function fixture(){
 const channel:any={logistics_channel_id:9,enabled:true,fee_type:'SIZE_INPUT',weight_limit:{item_min_weight:0,item_max_weight:0},item_max_dimension:{length:30,width:30,height:30,unit:'cm',dimension_sum:90}};
 let brandPages=(offset:number):any=>({brand_list:[{brand_id:0,original_brand_name:'NoBrand'}],has_next_page:false});
 const queries:{op:string;q:Record<string,string>}[]=[];
 const read=async(_id:string,_actor:string,path:string,q:Record<string,string>)=>{const op=path.split('/').pop()!;queries.push({op,q});switch(op){
  case 'get_shop_info':return {is_cb:false};
  case 'get_category':return {category_list:[{category_id:5,has_children:false}]};
  case 'get_channel_list':return {logistics_channel_list:[channel]};
  case 'get_item_limit':return {};
  case 'get_attribute_tree':return {list:[{category_id:5,attribute_tree:[]}]};
  case 'get_brand_list':return brandPages(Number(q.offset));
  default:throw Error('unexpected '+op);
 }};
 const team={shops:async()=>[shop],localization:async()=>({path:'product',issues:[]}),read:(_session:string,id:string,op:string,q:Record<string,string>)=>read(id,'admin',op,q)};
 return {channel,queries,read,team,setBrands:(fn:typeof brandPages)=>{brandPages=fn;}};
}
test('machine metadata resolves configured admin identity before direct reads and denies non-admin owners',async()=>{
 const f=fixture();let role='ADMIN',reads=0;
 const db={user:{findUnique:async(q:any)=>{assert.deepEqual(q,{where:{email:owner},select:{id:true,role:true}});return role==='MISSING'?null:{id:'admin',role};}},shopConnection:{findMany:async()=>[shop],findUnique:async()=>shop}};
 const service={read:async(id:string,actor:string,path:string,q:Record<string,string>)=>{assert.equal(actor,'admin');reads++;return f.read(id,actor,path,q);}};
 const platform=new LocalizationPlatform(undefined,db as never,service as never);
 const r=await platform.rawMetadata({owner},'shop',5);assert.equal(r.connectionId,'shop');assert.ok(reads>0);assert.deepEqual(f.queries.find(x=>x.op==='get_attribute_tree')?.q,{category_id_list:'5',language:'en'});
 const previous=reads;role='USER';await assert.rejects(()=>platform.rawMetadata({owner},'shop',5),/权限/);assert.equal(reads,previous);
 role='MISSING';await assert.rejects(()=>platform.rawMetadata({owner},'shop',5),/权限/);assert.equal(reads,previous);
});
test('team metadata uses production-compatible category parameter and includes brand candidates after first page',async()=>{
 const f=fixture();f.setBrands(offset=>offset===0?{brand_list:[{brand_id:0,original_brand_name:'NoBrand'}],has_next_page:true,next_offset:100}:{brand_list:[{brand_id:77,original_brand_name:'Source Brand'}],has_next_page:false});
 const p=new LocalizationPlatform(f.team as never),ctx={owner,sessionId:'session'};
 const raw=await p.rawMetadata(ctx,'shop',5);assert.deepEqual((raw.brands as any).brand_list.map((b:any)=>b.brand_id),[0,77]);
 assert.deepEqual(f.queries.find(x=>x.op==='get_attribute_tree')?.q,{category_id:'5',language:'en'});
 assert.deepEqual(f.queries.filter(x=>x.op==='get_brand_list').map(x=>x.q.offset),['0','100']);
 const d=draft();d.brandId=77;assert.deepEqual(await p.validateMarket(ctx,'shop',d),[]);
 f.setBrands(()=>({brand_list:[{brand_id:77}],has_next_page:false}));d.brandId=0;assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('品牌')));
});
test('brand pagination refuses malformed or unbounded results instead of declaring a partial list complete',async()=>{
 const f=fixture(),p=new LocalizationPlatform(f.team as never),ctx={owner,sessionId:'session'};
 f.setBrands(()=>({brand_list:[],has_next_page:true}));await assert.rejects(()=>p.rawMetadata(ctx,'shop',5),/分页/);
 f.setBrands(()=>({brand_list:[{brand_id:0}],has_next_page:'true'}));await assert.rejects(()=>p.rawMetadata(ctx,'shop',5),/不完整/);
 f.setBrands(offset=>({brand_list:[{brand_id:offset}],has_next_page:true,next_offset:offset+100}));const before=f.queries.filter(q=>q.op==='get_brand_list').length;const limited=await p.rawMetadata(ctx,'shop',5);assert.equal((limited.brands as any).candidatesIncomplete,true);assert.equal((limited.brands as any).has_next_page,true);assert.equal(f.queries.filter(q=>q.op==='get_brand_list').length-before,3);
});
test('live logistics dimension keys, three-edge sum and weight bounds reject incompatible packages; zero maxima mean no stated maximum',async()=>{
 const f=fixture(),p=new LocalizationPlatform(f.team as never),ctx={owner,sessionId:'session'},d=draft();
 assert.deepEqual(await p.validateMarket(ctx,'shop',d),[]);
 d.dimensionsCm.length=31;assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('包裹尺寸超出')));
 d.dimensionsCm={length:25,width:20,height:20};f.channel.item_max_dimension.dimension_sum=60;assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('三边和')));
 d.dimensionsCm={length:30,width:15,height:10};f.channel.item_max_dimension.dimension_sum=90;f.channel.weight_limit.item_min_weight=1;assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('重量超出')));
 f.channel.weight_limit.item_min_weight=0;d.weightKg=null;f.channel.weight_limit.item_max_weight=5;assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('需填写重量')));
});
test('volume restrictions require an understood unit and compare actual package volume when unit is known',async()=>{
 const f=fixture(),p=new LocalizationPlatform(f.team as never),ctx={owner,sessionId:'session'},d=draft();
 f.channel.volume_limit={item_max_volume:100};assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('体积限制单位尚未确认')));
 f.channel.volume_limit={unit:'cm3',item_max_volume:4000};assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('体积超出')));
 f.channel.volume_limit={unit:'m3',item_max_volume:.005};assert.deepEqual(await p.validateMarket(ctx,'shop',d),[]);
 f.channel.item_max_dimension.unit='UNKNOWN';assert.ok((await p.validateMarket(ctx,'shop',d)).some(x=>x.includes('尺寸限制单位尚未适配')));
});

test('attribute failure stops brand pagination before any brand requests are sent',async()=>{
 const f=fixture();const team={...f.team,read:async(session:string,id:string,op:string,q:Record<string,string>)=>{if(op==='get_attribute_tree')throw new Error('attribute failed');return f.team.read(session,id,op,q);}};
 const p=new LocalizationPlatform(team as never);await assert.rejects(()=>p.rawMetadata({owner,sessionId:'session'},'shop',5),/attribute failed/);assert.equal(f.queries.filter(q=>q.op==='get_brand_list').length,0);
});
