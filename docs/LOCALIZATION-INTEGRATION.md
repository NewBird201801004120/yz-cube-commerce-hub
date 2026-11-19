# 仿真商品接收 API

| 项目 | 配置 |
| --- | --- |
| 文档日期 | 2026-11-19 |
| 请求结构版本 | schemaVersion: 2；URL前缀仍为/api/v1 |
| 协议 | HTTPS，JSON，UTF-8 |
| 生产API_BASE | https://commerce.aicbec.cn |
| 本地API_BASE | http://127.0.0.1:4100（仅同机；跨机器使用可访问的联调网关地址） |
| SOURCE_SYSTEM | simulation，填写product.sourceSystem；不是HTTP请求头 |
| 路径前缀 | /api/v1/localization/integration |
| v2状态 | 本地开发版本；尚未完成本次生产部署验收，不应直接按v2向生产发送 |

## 1. 接口清单

| 方法 | 路径 | 用途 | 成功状态 |
| --- | --- | --- | --- |
| POST | /imports | 提交完整源商品，不选择店铺或语言 | 201 |
| GET | /imports/{id} | 查询接收记录及关联市场版本发布结果 | 200 |
| GET | /listing/jobs | 获取当前令牌所属中台账号已完成的组图结果 | 200 |
| GET | /listing/jobs/{jobId}/images/{slotId} | 下载一张已完成图片（二进制） | 200 |

v2调用顺序：POST商品 → 保存返回id → GET查询。选目标店铺、选语言、文案转译、审核和发布均在中台操作。接收不触发AI、不创建Shopee商品，不公开发布。图片内容不转译。

旧v1兼容接口见第9节；新接入不需要调用店铺、规则查询或文案重试接口。

## 2. 鉴权及通用约定

| 请求头 | 类型 | 必填 | 值 |
| --- | --- | --- | --- |
| Authorization | string | 全部接口是 | Bearer <专用接入令牌> |
| Content-Type | string | POST是 | application/json |

专用令牌由中台单独安全交付，调用方不自行生成；没有令牌生成/刷新接口。令牌长期有效，可由中台撤销或轮换；生产沿用同一已启用令牌时无需更换。切换环境时核对API_BASE及该环境是否已启用该令牌，SOURCE_SYSTEM不变。

仅调用方服务端保存和使用令牌。禁止将令牌写入前端、日志或Git。不得携带Origin或Cookie；浏览器会话、账号密码、Shopee access_token不能替代专用令牌。令牌只授权本接入方的接收及查询，不授予真实商品发布权限。目标店铺由中台登录人员在该账号可用的已授权店铺中选择。

- 字段名区分大小写，未定义字段拒绝；可选字段未知时省略，不传null。
- JSON number不使用引号；integer为安全整数，最大9007199254740991。
- 数组顺序有意义；时间为UTC ISO 8601字符串。
- 响应直接返回对象，不包data。应用正常响应含X-Request-Id和Cache-Control: no-store；代理拒绝可能例外。
- 服务端请求体解析上限12MB，同时受网关限制；图片仅传URL，不嵌入Base64。
- 本契约完整性要求与Shopee各市场条件必填不同，详见第7节。

## 3. 提交商品

**POST {API_BASE}/api/v1/localization/integration/imports**

### 3.1 顶层字段

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| schemaVersion | integer | 是 | 固定2 |
| requestId | string | 是 | 1–150字符，正则^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$；由发送方生成的幂等键 |
| product | object | 是 | 第3.2节 |
| publishing | object | 是 | 第3.3节 |

v2禁止target和locationId字段；不传connectionId、country、language、categoryId、brandId、attributes、logistics。目标市场的类目、属性、品牌及物流ID由中台匹配，不能沿用源市场ID。

### 3.2 product

| 字段（product.前缀） | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| schemaVersion | integer | 是 | 固定1，为商品对象版本，与顶层2不同 |
| sourceSystem | string | 是 | 1–100字符，与令牌配置一致，当前simulation |
| sourceProductId | string | 是 | 1–150字符，源平台商品标识；不是Shopee商品ID |
| title | string | 是 | 非空，最多500字符 |
| description | string | 是 | 非空，最多20000字符 |
| images | string[] | 是 | 1–9个公开HTTPS图片地址，按顺序，首张主图；每个URL最多2048字符 |
| parameters | object<string,string> | 是 | 最多100项；键1–100字符、值最多1000字符；未知可为{}，仅提供真实事实 |
| specificationNames | string[] | 是 | 0–2个规格维度名称，每项1–100字符；无规格用[] |
| variants | object[] | 是 | 1–100个SKU，详见下表 |
| weightKg | number | 是 | 包装毛重，大于0，单位kg |
| dimensionsCm | object | 是 | length、width、height三个number全部大于0，单位cm |
| media | object | 否 | 结构化详情及规格配图，见第3.4节 |

| 字段（product.variants[].前缀） | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| sku | string | 是 | 1–100字符，全商品唯一；不是主商品货号 |
| options | string[] | 是 | 数量等于specificationNames，维度顺序对应，每项1–100字符 |
| stock | integer | 否 | 非负；不能替代publishing.variants[].stock |

全部SKU的options组合不得重复。无规格商品仅一个SKU，specificationNames和options均为[]。主商品货号不是仿真必填字段。

parameters可填写来源类目名称或路径（键“类目”）、真实品牌名称（键“品牌”，明确无品牌时传“无品牌”）及真实材质等事实；均不是目标ID。图片不能使用内网、localhost、裸IP、带用户密码或自定义端口的地址；资源须能由中台服务器下载，不能依赖浏览器登录Cookie。接收只检查结构，下载、内容解码及平台图片限制在预览/发布准备阶段再检查。

### 3.3 publishing

| 字段（publishing.前缀） | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| currency | string | 是 | 三位大写币种代码，如PHP；表示本次提供价格的币种 |
| variants | object[] | 是 | 1–100项，与product.variants全部SKU一一对应，无遗漏、无额外或重复SKU |
| marketPrices | object[] | 否 | 最多20项额外币种的最终售价及库存；每项{currency,variants}，结构同默认currency/variants；每个币种完整覆盖所有SKU |
| condition | string | 否 | NEW或USED；不是统一必填项，未知不填 |
| preOrder | object | 否 | isPreOrder:boolean必填；daysToShip:integer可选且大于0；按目标规则校验 |

| 字段（publishing.variants[].前缀） | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| sku | string | 是 | 与product.variants[].sku完全相同 |
| price | number | 是 | currency币种的最终售价，大于0；不是采购价或汇率参考价 |
| stock | integer | 是 | 非负安全整数，允许0 |
| gtinCode | string | 否 | 1–32位数字字符串；目标要求时提供真实GTIN，后续还检查长度及校验位 |

默认currency与marketPrices各币种不得重复。选择店铺时，按店铺币种使用默认价格或marketPrices中相同币种的确认价格；没有对应币种则阻断，不自动换算为最终售价，须由发送方补传。GTIN不是随意补数通过的字段。

跨币种示例（价格仅演示结构）：

```json
{"currency":"PHP","variants":[{"sku":"SKU-1","price":100,"stock":1}],"marketPrices":[{"currency":"SGD","variants":[{"sku":"SKU-1","price":5,"stock":1}]}]}
```

以上两个价格均须由发送方确认；单一SKU示例不能直接拼入多SKU商品，实际每币种均须覆盖全部SKU。

### 3.4 media（可选）

传media时assets、variantImages、detailBlocks三个数组都必须提供，允许空数组。不存在media时仅使用images。

| 字段（product.media.前缀） | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| assets | object[] | 是 | 最多30项；id唯一；gallery用途最多9项 |
| assets[].id | string | 是 | 1–100字符，^[A-Za-z0-9_-]+$ |
| assets[].url | string | 是 | 同images的HTTPS URL限制 |
| assets[].role | string | 是 | gallery、detail或variant |
| assets[].sourceLanguage | string | 否 | 图片原语言说明，1–80字符 |
| assets[].textInImage | string | 是 | unknown、none或present；仅记录事实，不触发图片翻译 |
| variantImages | object[] | 是 | 最多100项 |
| variantImages[].sku | string | 是 | 引用product.variants中的SKU，同SKU最多一项 |
| variantImages[].assetId | string | 是 | 引用assets中的id |
| detailBlocks | object[] | 是 | 最多40项，保留顺序，以下两种之一 |
| detailBlocks[]（文字） | object | — | {"type":"text","text":"非空文字"}，文字总长度最多20000字符 |
| detailBlocks[]（图片） | object | — | {"type":"image","assetId":"已有素材id"} |

assets中role=gallery的URL必须同时出现在images中，否则发布前阻断。多规格配图按首层选项组织，同首层选项必须使用同一张图。文字详情可以随商品文字转译；图片像素和图片中的文字保持原样。

### 3.5 完整请求示例

以下仅为结构测试示例，不代表真实商品或获准公开发布。

```json
{
  "schemaVersion": 2,
  "requestId": "simulation-source-v2-example-001",
  "product": {
    "schemaVersion": 1,
    "sourceSystem": "simulation",
    "sourceProductId": "mock-shoe-storage-full-001",
    "title": "接口联调示例商品（非卖品）",
    "description": "用于接口联调的模拟收纳盒，不销售。白色，小号和大号两种规格。模拟包装长20厘米、宽12厘米、高8厘米，毛重0.2千克。示例参数和图片仅用于接口结构说明，不代表实际商品事实。",
    "images": [
      "https://cf.shopee.ph/file/sg-11134201-825av-mvh8mtinrpc6e6"
    ],
    "parameters": {
      "类目": "家居用品 > 收纳用品 > 鞋盒",
      "品牌": "无品牌",
      "测试说明": "仅用于结构示例，发送真实商品时必须替换为真实资料"
    },
    "specificationNames": [
      "Color",
      "Size"
    ],
    "variants": [
      {
        "sku": "MOCK-NOT-FOR-SALE-WHITE-SMALL",
        "options": [
          "White",
          "Small"
        ],
        "stock": 0
      },
      {
        "sku": "MOCK-NOT-FOR-SALE-WHITE-LARGE",
        "options": [
          "White",
          "Large"
        ],
        "stock": 0
      }
    ],
    "weightKg": 0.2,
    "dimensionsCm": {
      "length": 20,
      "width": 12,
      "height": 8
    }
  },
  "publishing": {
    "currency": "PHP",
    "variants": [
      {
        "sku": "MOCK-NOT-FOR-SALE-WHITE-SMALL",
        "price": 10,
        "stock": 0
      },
      {
        "sku": "MOCK-NOT-FOR-SALE-WHITE-LARGE",
        "price": 12,
        "stock": 0
      }
    ],
    "condition": "NEW",
    "preOrder": {
      "isPreOrder": false
    }
  }
}
```

### 3.6 成功响应

```json
{
  "id": "d7df7f6a-9afa-5a5f-a1e8-530e79b66719",
  "requestId": "simulation-source-v2-example-001",
  "status": "received",
  "sourceId": "cda18033-fcd1-5bac-a60b-31339f43ee09",
  "reviewSourceId": "cda18033-fcd1-5bac-a60b-31339f43ee09",
  "draftId": "",
  "reviewPath": "/tools/localization?source=cda18033-fcd1-5bac-a60b-31339f43ee09",
  "title": "接口联调示例商品（非卖品）",
  "sourceSystem": "simulation",
  "sourceProductId": "mock-shoe-storage-full-001",
  "shopName": "",
  "country": "",
  "language": "",
  "currency": "PHP",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "publishTasks": []
}
```

| 响应字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 中台接收记录ID；用于后续查询 |
| requestId | string | 原幂等键 |
| status | string | v2固定received，表示源资料已接收，不表示AI或Shopee已完成 |
| sourceId | string | 中台源商品ID |
| reviewSourceId | string | 中台审核页面使用的只读来源标识；v2与sourceId相同，旧v1可能不同；调用方原样保存，不自行生成或推导 |
| draftId | string | v2接收阶段为空；未自动创建目标市场版本 |
| reviewPath | string | 中台操作页面的相对路径，需要中台登录；不是机器鉴权访问地址 |
| title、sourceSystem、sourceProductId | string | 原商品名称及来源标识 |
| shopName、country、language | string | v2接收时为空；目标选择在中台进行 |
| currency | string | 当前源请求价格币种 |
| createdAt | string | UTC创建时间 |
| publishTasks | object[] | 当前账号下、同一sourceId所有市场版本的发布任务摘要；未提交发布时[]。字段见第4节 |
| localizationError | string | 可选；旧v1文案错误说明 |
| note | string | 可选提示，不作为状态判断依据 |

## 4. 查询接收记录

**GET {API_BASE}/api/v1/localization/integration/imports/{id}**

路径参数id:string，使用POST返回的id。无查询参数、无请求体；成功200，返回第3.6节同结构。仅能查询当前令牌接入方及所属账号的记录，不支持通过sourceProductId替代id。

v2的publishTasks汇总当前所属账号下、同一sourceId的全部市场版本任务，包含原文上架及转译上架；未提交发布时为[]。旧v1仅返回对应draftId的任务。接收status始终为received，不能用它判断发布是否成功，应读取publishTasks。此数组仅返回下述安全摘要，不包含其他账号的任务或发布请求快照。

publishTasks每项包含id:string、status:string、stage:string，以及可选remoteId:string、error:string。remoteId是Shopee远端商品ID，出现remoteId仍不等于完成公开发布。任务状态：

| status | 含义 |
| --- | --- |
| preparing | 检查资格、准备图片与请求 |
| creating | 已进入商品创建步骤 |
| uncertain | 创建结果不明确，必须先核对远端，不能盲目新建 |
| created | 远端商品已创建，后续步骤待完成 |
| completing | 正在完成规格及市场发布 |
| succeeded | 发布任务成功 |
| failed | 当前步骤失败；结合remoteId及错误判断是否已创建 |

## 5. 错误响应

```json
{
  "code": "HTTP_400",
  "message": "商品资料不完整：publishing.variants[0].price：必须提供大于0的目标币种最终售价",
  "fieldErrors": [
    {"field":"publishing.variants[0].price","message":"必须提供大于0的目标币种最终售价"}
  ],
  "requestId": "17e608f3-0c01-4c38-a897-7b3e5dd59e84"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| code | string | 应用错误码，例如HTTP_400；平台错误可能使用上游码 |
| message | string | 错误说明，不作为稳定机器错误码 |
| fieldErrors | object[] | 可选；field:string、message:string；缺少必需商品事实时列出字段路径 |
| requestId | string | 可选HTTP追踪ID，与提交幂等requestId不同 |
| diagnostic | object | 可选脱敏上游诊断；不包含凭据 |
| diagnostic.upstreamCode | string | 上游码，未知时unknown |
| diagnostic.upstreamRequestId | string | 可选上游追踪ID |

| HTTP | 原因 | 处理 |
| --- | --- | --- |
| 400 | 缺必填事实、格式/版本/未知字段、重复SKU组合 | 修正JSON；缺事实时不创建来源、记录、草稿或AI任务 |
| 401 | 令牌缺失、无效、停用，或携带Origin/Cookie | 核对服务端配置与请求头 |
| 403 | sourceSystem与接入配置不符或授权撤销 | 核对来源系统及令牌权限 |
| 404 | id无效、不存在或不属当前接入方 | 使用原返回id与原身份 |
| 409 | 同requestId提交不同内容或操作冲突 | 不覆盖原记录；修改内容须使用新requestId |
| 413 | 网关请求体过大 | 使用图片URL、缩小请求 |
| 500/502/503/504 | 服务或上游不可用 | 保留原requestId及内容重试；记录HTTP追踪ID |

部分解析/代理错误可能返回非JSON或仅message；以HTTP状态优先。并非所有格式错误均含fieldErrors。

## 6. 幂等与超时

相同接入方、账号、requestId和请求内容重复POST返回原记录（仍为201），不重复创建。JSON对象键顺序不影响内容指纹，数组顺序影响。同requestId内容改变返回409。requestId不是sourceProductId；修订商品事实需使用新requestId，保留原记录。

POST超时先用同一requestId和完全相同内容重试，不能换新requestId猜测。收到id后GET轮询即可。接收记录不是发布任务，重复提交不会触发真实发布。真实发布只由中台运营主动确认，创建超时由中台先核对远端结果。

## 7. 地区及目标店铺差异

本结构是中台接收接口，不是Shopee原始请求，不能把任意Shopee字段追加到JSON。源资料完整性是统一要求，最终发布条件由目标店铺、类目、渠道及平台返回的规则确定。

| 项目 | 仿真传入 | 中台处理 / 条件限制 |
| --- | --- | --- |
| 标题、描述、规格文字 | 原始真实文字及规格结构 | 按选定语言转译，校验目标长度；不改变SKU及商品事实 |
| 图片 | 可下载URL及可选配图引用 | 上传并适配格式；不翻译图片文字；目标尺寸、数量限制另检 |
| 售价、库存 | currency及全部SKU最终price/stock，统一必填 | 按店铺币种选择currency或marketPrices的确认价格；校验价格/库存范围，不自动生成最终售价 |
| 重量、尺寸 | kg及完整cm三维，统一必填 | 再校验目标mandatory及物流限制；不宣称全球每个市场都强制输入尺寸 |
| 类目 | 可选parameters["类目"]名称或路径 | 必须匹配目标可用末级类目；仿真不需要类目查询接口或目标ID |
| 属性 | parameters中的已知真实属性，可{} | 仅目标mandatory且缺事实时阻断；不是所有属性必填 |
| 品牌 | 可选真实品牌名称，明确无品牌可传“无品牌” | 根据目标类目候选匹配，不假定全球都支持NoBrand/0 |
| 物流 | 无须发送渠道ID | 中台读取店铺已配置渠道并校验商品重量尺寸；仍须在Shopee商品请求显式带渠道开关 |
| GTIN | 目标要求时提供真实gtinCode | 按目标规则检查，不能用mock/默认编码替代真实编码 |
| 仓位、预售 | v2不接受locationId；已确认预售事实可传preOrder | 仓位由中台按目标店铺处理；不跨店铺套用仓位或发货天数 |
| 税务、认证、尺码表等 | 当前v2无通用字段 | 目标要求且现有适配不支持时阻断，不静默省略 |

BR、MX、CO、CL因地区附加资料尚未完整适配，当前发布校验阻断。global_product商家级授权、多仓分配、部分属性依赖和地区监管资料尚未完整支持。其他市场也不因接收成功而保证发布成功。

已有真实验证仅覆盖PH指定店铺/类目：2026-11-17英文厨房套装完成add_item和两规格初始化，远端回读UNLIST，未公开发布。该次必须补充的来源事实为最终售价、库存、包裹三维；类目、品牌和渠道由中台组装。condition、GTIN、locationId、preOrder及全部可选属性未提供仍保存成功。此结果不能外推全部国家/类目，也不代表本次v2或公开发布已完成生产验收。

## 8. 服务端调用示例

令牌通过调用方环境LOCALIZATION_TOKEN注入；不要写入代码。request.json使用第3.5节JSON并替换全部测试资料。

```sh
API_BASE='http://127.0.0.1:4100'
curl --request POST "$API_BASE/api/v1/localization/integration/imports" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary @request.json
```

```sh
curl --request GET "$API_BASE/api/v1/localization/integration/imports/$IMPORT_ID" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN"
```

生产启用v2并验收后，将API_BASE改为生产地址；源码中的SOURCE_SYSTEM仍为simulation，已启用专用令牌可保持不变。

## 9. 旧v1兼容

顶层schemaVersion:1继续使用原结构：product加target:{connectionId,country,language?,publishing:{variants,...}}，同步保存目标草稿、异步转译。v1的product仍schemaVersion:1；价格来自目标店铺币种，target.publishing不接受currency。不要将v1与v2字段混合。

| 兼容接口 | 用途 |
| --- | --- |
| GET /shops | 旧调用方查询已连接店铺及language、supportedLanguages；新v2不需要 |
| POST /imports/{id}/localize | 旧v1文案失败重试；v2返回400，必须在中台选店铺语言后转译 |

v1状态为localizing、awaiting_review、localization_failed（中断pending会恢复为失败）；这些状态与v2的received不同。现有v1记录仍可查询，原令牌不因结构升级失效。v1已部署不等于v2已部署。

## 附录：结构校验文件

主文档已提供调用所需字段及示例。仓库另提供机器校验资产：localization-import-v2.schema.json（JSON Schema Draft 2020-12）、localization-import-v2.example.json（含两维四SKU及详情素材的完整测试示例）。Schema不能替代SKU关联、币种匹配、授权状态和目标市场动态校验。原v1 schema/example保留用于兼容，不用于v2提交。


## 11. 读取中台已生成图片

本节接口为新增本地开发能力，生产需部署本次代码后才能使用。只读取已生成结果，不启动生成、不产生模型调用。

### 11.1 GET /listing/jobs

鉴权：与商品接收相同的专用 Bearer 令牌，仅服务端调用；不带 Cookie、Origin。无请求体、无查询参数。只返回令牌 ownerEmail 所属账号最近100个任务中已完成的图片；只有未完成图片的任务不返回。任务或图片不存在、已删除或不属于该账号时不能下载。此范围不按店铺筛选。

响应：HTTP 200，application/json。

```json
{
  "jobs": [{
    "jobId": "a8c957d2-ee0a-4e4c-83a4-204b1872cf99",
    "name": "耳机组图",
    "market": "PH",
    "language": "English",
    "sku": "EARPHONE-01",
    "slots": [{
      "id": "hero",
      "title": "商品首图",
      "imagePath": "/api/v1/localization/integration/listing/jobs/a8c957d2-ee0a-4e4c-83a4-204b1872cf99/images/hero"
    }]
  }]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| jobs | object[] | 无可用图片时为[] |
| jobs[].jobId | string | 组图任务ID |
| jobs[].name | string | 任务名称，不是仿真商品ID |
| jobs[].market | string | 组图任务目标市场，按任务实际值返回，不作为店铺国家ID |
| jobs[].language | string | 组图任务图片文案语言；下载或商品转译不会改图片文字 |
| jobs[].sku | string，可缺省 | 创建组图时填写的货号；可能为空，不保证与仿真商品一一对应 |
| jobs[].slots | object[] | 只包含status=success且图片文件已生成的槽位 |
| jobs[].slots[].id | string | 图片槽位ID，按响应原样使用 |
| jobs[].slots[].title | string | 图片用途名称 |
| jobs[].slots[].imagePath | string | 以/api/v1开头的图片下载路径；用API_BASE拼接，服务端带相同Bearer令牌下载 |

组图任务尚无仿真sourceProductId绑定字段。发送方应按已确认的jobId或实际货号关联，不能仅凭名称自动认定为同一商品。此接口不接收仿真图片生成请求。

### 11.2 GET /listing/jobs/{jobId}/images/{slotId}

| 路径参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| jobId | string | 是 | 查询返回的任务ID |
| slotId | string | 是 | 查询返回的槽位ID；作为路径段时URL编码 |

响应：HTTP 200，图片二进制；Content-Type为实际image/png、image/jpeg或image/webp；Cache-Control: private, no-store。401表示令牌无效、禁用或携带浏览器Cookie/Origin；404表示任务或完成图片不存在、已删除或不属于令牌账号；400表示图片格式不可用。

```bash
curl --fail "$API_BASE/api/v1/localization/integration/listing/jobs" \
  -H "Authorization: Bearer $INTEGRATION_TOKEN"

curl --fail "$API_BASE$IMAGE_PATH" \
  -H "Authorization: Bearer $INTEGRATION_TOKEN" \
  -o generated-product-image
```

imagePath是受鉴权的服务端下载接口，不是匿名公开图片URL，不能直接放到浏览器img或商品接收product.images中。仿真服务端下载后可上传到自己的可访问图片存储，再使用该HTTPS URL展示或提交product.images。不得把专用令牌放进URL、浏览器或前端代码。图片重生成会更新同一槽位的结果，需固定成品时应下载保存；中台应用到市场版本时保存独立图片副本，后续重生成不改变已保存的版本图片。

## v1 兼容说明

旧版 `schemaVersion: 1` 请求的 `target.connectionId`、`target.country`、`target.language` 可省略：服务端沿用已授权店铺默认值，国家由店铺确定，语言采用店铺默认语言；指定国家时必须与所选店铺匹配。新接入仍使用本文件的 `schemaVersion: 2` 源商品契约，在中台选择目标店铺和语言。两种版本均须完整提供商品、售价与库存资料。
