# 商品本地化接入 API 文档

| 项目 | 值 |
| --- | --- |
| 接口版本 | v1 |
| 更新日期 | 2026-11-17 |
| 协议及编码 | HTTPS / JSON / UTF-8 |
| API_BASE | https://commerce.aicbec.cn |
| SOURCE_SYSTEM | simulation，填写到product.sourceSystem，不作为请求头 |
| 路径前缀 | /api/v1/localization/integration |
| 接入状态 | 4个接口、target.publishing字段及中台自动适配已于2026-11-17部署到上述生产地址，并完成专用令牌公网验证 |

本文仅定义外部服务接入接口。导入接口不创建或发布Shopee商品；专用令牌不授权商品保存、修改或发布。

## 接入责任与交付资料

仿真平台负责发送完整、真实的商品资料；中台负责文案翻译、目标类目/属性/品牌匹配、读取店铺已配置物流并适配虾皮请求。仿真无需查询Shopee规则、选择目标类目ID、属性ID或物流ID。

标准调用顺序：查询店铺 → 选择店铺及目标语言 → POST商品 → 查询接收结果 → 在中台预览确认。接收成功是中台草稿保存成功，不等于已创建Shopee未上架商品；Shopee UNLIST保存和公开上架结果分别核对。

| 仿真发送项 | 完整商品交付要求 | 中台责任 |
| --- | --- | --- |
| product.title、description、images | 非空标题/描述、至少1张可下载商品图；缺少或为空直接返回400，不创建记录 | 翻译文案、上传图片、检查目标限制；图片像素不自动翻译 |
| product.specificationNames、variants[].sku/options | 完整规格与唯一SKU，无规格用空维度与单SKU | 翻译规格文字，保留SKU和组合 |
| target.publishing.variants[].sku/price/stock | 完整覆盖全部SKU，最终目标币种售价、非负整数库存（允许0）；仿真不必传其他publishing字段 | 不用汇率或AI猜最终售价/库存 |
| product.weightKg、dimensionsCm.length/width/height | 本接入契约全部必填，kg/cm；中台再检查目标店铺实际限制 | 校验目标店铺mandatory标记及渠道限制 |
| product.parameters | 已知真实属性按名称和值提供，可为{}；不要求填写全部可选属性 | 映射目标属性，仅对目标必填且缺事实的项目提示补资料 |
| product.parameters["类目"] | 有则传来源类目名称/路径；不是目标ID；可省略 | 结合商品资料匹配目标末级类目，未可靠匹配时明确提示，低置信度结果不自动采用 |
| product.parameters["品牌"] | 有品牌传真实名称；确认为无品牌时明确传“无品牌”；未知不伪造 | 映射品牌；目标允许时使用NoBrand/0 |
| 物流、默认仓位、非预售发货时效 | 不要求仿真重复提交店铺已经配置的渠道ID、仓位ID或默认时效 | 读取目标店铺配置、检查可用性并组装商品请求；不能把店铺渠道enabled直接当作已保存的商品开关 |
| GTIN、预售及地区附加事实 | 仅目标实际要求且不能由店铺配置复用时补充，不作为当前PH普通商品统一必填 | 区分店铺配置与商品事实；未适配要求明确提示，不猜测或静默省略 |

当前仿真厨房套装的已保存来源资料有文案、3张图、2个SKU和0.722kg重量，缺SKU最终售价、库存、包装长宽高。中台已上线目标类目、真实参数对应的属性、品牌与物流自动适配。不要求仿真提交目标ID。当前来源仅有品牌参数，不能视作已经包含所有目标类目可能要求的真实属性。

当前PH厨房套装真实保存核对（2026-11-17）：使用现有英文版仿真商品调用真实product/add_item，逐项补齐后创建item_id=51121732523，init_tier_variation保存原始两款SKU并回读成功，item_status=UNLIST。此次未提交condition、GTIN、仓位、预售或属性，仍创建成功；因此这些不是本商品另需仿真补传的统一必填。回读默认condition=NEW、location_id=PHZ、非预售days_to_ship=1，仅说明本店本商品的实际默认行为。保留真实原文、SKU、图片和0.722kg重量；最终售价999PHP/款和30×15×10cm为mock，库存1/款按用户提供。没有公开上架或修改已有在售商品。

接收完整性：新增请求缺少最终售价、库存、包装重量或任一包装尺寸，返回HTTP400及fieldErrors字段清单，不创建来源、接收记录、市场草稿或AI任务。目标类目ID仍非必填，由中台匹配；属性、品牌和物流使用来源事实及真实店铺配置适配。接收后的awaiting_review表示文案待预览，不表示商品已在Shopee创建。历史不完整记录可继续查询；重新POST同样的不完整请求也会被拒绝，补齐历史请求内容时应使用新requestId。

## 1. 通用约定

- 字段名区分大小写，未定义请求字段会被拒绝。
- 可选字段未知时省略，不传null；数组顺序有意义。
- integer表示JSON整数；库存不得超过安全整数9007199254740991。
- 时间为UTC ISO 8601字符串，例如2026-11-13T08:00:00.000Z。
- 成功响应直接返回对象或数组，不使用统一data封装。
- 服务端请求体解析上限12MB，实际还受代理限制。
- 正常响应携带X-Request-Id及Cache-Control: no-store；代理或解析阶段拒绝可能不具备上述响应头。

## 2. 鉴权

### 2.1 请求头

| 请求头 | 类型 | 必填 | 格式 |
| --- | --- | --- | --- |
| Authorization | string | 全部接口是 | Bearer &lt;专用接入令牌&gt; |
| Content-Type | string | POST是 | application/json |

令牌原始值匹配正则 `^[A-Za-z0-9_-]{32,256}$`。仅限服务端调用；携带Origin或Cookie请求头会被拒绝。浏览器登录Cookie、管理员密码、Shopee access_token均不能代替此令牌。

### 2.2 令牌

| 项目 | 规则 |
| --- | --- |
| 获取方式 | 专用令牌单独提供；无生成或刷新接口 |
| 有效期 | 不自动过期，生产沿用；可由中台停用或更换 |
| 店铺范围 | 当前及新增的全部已连接店铺，无需店铺白名单 |
| 允许操作 | 查询店铺、导入商品、查询记录、重试文案生成；不授权商品写入 |
| 隔离约束 | 不可指定owner，不可访问其他接入方记录 |

connectionId通过3.1查询获取。令牌只保存在调用方服务端。

## 3. 接口定义

| 编号 | 方法 | 路径 | 成功HTTP状态 |
| --- | --- | --- | --- |
| 3.1 | GET | /api/v1/localization/integration/shops | 200 |
| 3.2 | POST | /api/v1/localization/integration/imports | 201 |
| 3.3 | GET | /api/v1/localization/integration/imports/{id} | 200 |
| 3.4 | POST | /api/v1/localization/integration/imports/{id}/localize | 201 |

POST重放同样返回201，不表示新建另一条记录。异步状态由响应体status字段表示。

### 3.1 查询店铺

**GET https://commerce.aicbec.cn/api/v1/localization/integration/shops**

路径参数：无。查询参数：无。请求体：无。

成功响应示例：

```json
[
  {
    "id": "REPLACE_WITH_AUTHORIZED_CONNECTION_ID",
    "shopId": "123456789",
    "shopName": "Example PH Shop",
    "region": "PH",
    "currency": "PHP",
    "language": "English",
    "supportedLanguages": [
      "English",
      "Filipino"
    ],
    "status": "CONNECTED"
  }
]
```

| 响应字段 | 类型 | 说明 |
| --- | --- | --- |
| 根对象 | object[] | 当前中台已适配地区的全部CONNECTED店铺，包含以后新增授权的店铺；缺少币种/默认语言映射的店铺不返回；无结果返回[] |
| [].id | string | 中台连接ID，对应target.connectionId，不是Shopee shop_id |
| [].shopId | string | Shopee店铺ID，以字符串返回 |
| [].shopName | string | 店铺名称 |
| [].region | string | 国家/地区代码，对应target.country |
| [].currency | string | 目标币种，不允许调用方覆盖 |
| [].language | string | 默认文案语言，可作为target.language初始值 |
| [].supportedLanguages | string[] | 可选文案语言，非空、不重复，首项为language；target.language须传本数组中的原值 |
| [].status | string | 当前固定CONNECTED，不代表写权限已验证 |

语言列表由本接口返回，不需要单独调用语言接口。language为默认值，supportedLanguages为按目标市场限定的下拉选项（PH为English、Filipino，不再返回所有工具语种）；值区分大小写，不以en、th等代码替代English、ไทย。此列表表示工具提供的文案生成选项，不代表Shopee各市场允许任意语言上架；目标平台要求另行校验。 菲律宾语（Filipino）可作为文案生成目标；PH店铺默认语言仍按店铺实际映射返回，选择菲律宾语不代表已验证Shopee商品发布端接受该语言。 仿真平台需要生成菲律宾语时，POST请求必须将 `target.language` 传为 `Filipino`；传 `English` 就会按英语生成。菲律宾盾币种仍由店铺返回为 `PHP`，不能写入language字段。

当前地区默认值：

| region | currency | language |
| --- | --- | --- |
| PH | PHP | English |
| SG | SGD | English |
| MY | MYR | Bahasa Melayu |
| TH | THB | ไทย |
| VN | VND | Tiếng Việt |
| TW | TWD | 繁體中文 |
| ID | IDR | Bahasa Indonesia |
| BR | BRL | Português |
| MX | MXN | Español |
| CO | COP | Español |
| CL | CLP | Español |

以实际查询响应为准，不在调用方硬编码语言列表或地区映射。更换店铺后重新使用该店铺的language及supportedLanguages。

### 3.2 导入商品

**POST https://commerce.aicbec.cn/api/v1/localization/integration/imports**

请求体：application/json。同步建立来源快照与目标草稿，异步执行文案生成。

#### 3.2.1 请求字段

下表必填性仅指本接口接收条件；目标地区的保存/发布必填条件见第6节。

| 字段 | JSON 类型 | 必填 | 要求 |
| --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 接收信封版本，固定数字 `1` |
| `requestId` | string | 是 | 唯一业务请求标识，最长150字符，以英文字母或数字开头，其余仅字母、数字、`_`、`.`、`:`、`-`；网络重试保留原值和原始内容 |
| `product` | object | 是 | 来源商品对象 |
| `product.schemaVersion` | integer | 是 | 来源结构版本，固定 `1`；与信封独立演进 |
| `product.sourceSystem` | string | 是 | 与接入配置一致，非空，最长100字符 |
| `product.sourceProductId` | string | 是 | 中台接入要求的稳定来源标识，非空，最长150字符；跨国家保持一致；不是Shopee主商品货号 |
| `product.title` | string | 是 | 非空来源标题，最长500字符 |
| `product.description` | string | 是 | 非空，最长20000字符；空白内容返回400 |
| `product.images` | string[] | 是 | 至少1张，最多9张；公开HTTPS地址，每个最长2048字符；不传平台图片ID、base64或本地路径 |
| `product.parameters` | object，值为string | 是 | 可为 `{}`；最多100项，键1—100字符，值最长1000字符；只填已知事实 |
| `product.parameters["类目"]` | string | 否 | 仿真所选类目名称或完整路径，例如 `家居用品 > 厨房用品 > 厨具套装`；未选择时省略。中台自动匹配目标市场末级类目，不传来源类目ID；未可靠匹配则阻止发布。 |
| `product.parameters["物流"]` | string | 否 | 仿真提供的物流名称或说明；未提供时省略，页面不展示物流渠道候选。文字说明不等于目标店铺的物流渠道ID；结构化配置使用target.publishing.logistics，发布前校验目标渠道有效性。 |
| `product.specificationNames` | string[] | 是 | 最多2项，每项非空且最长100字符；无规格用 `[]` |
| `product.variants` | object[] | 是 | 1—100个SKU对象 |
| `product.variants[].sku` | string | 是 | 中台用于关联规格、售价、库存和配图的规格标识，商品内唯一，非空，最长100字符；属于接入契约要求，不表示Shopee主商品货号必填 |
| `product.variants[].options` | string[] | 是 | 与规格维度一一对应，每项非空且最长100字符；无规格用 `[]` |
| `product.variants[].stock` | integer | 否 | 非负安全整数；发布前确认真实库存 |
| `product.weightKg` | number | 是 | 大于零，单位公斤，实际发货包装重量 |
| `product.dimensionsCm` | object | 是 | 实际包装尺寸，以下三项必须齐全 |
| `product.dimensionsCm.length` | number | 是 | 大于零，单位厘米 |
| `product.dimensionsCm.width` | number | 是 | 大于零，单位厘米 |
| `product.dimensionsCm.height` | number | 是 | 大于零，单位厘米 |
| `product.media` | object | 否 | 规格配图与图文详情扩展，结构见后文与内嵌Schema |
| `target` | object | 是 | 目标市场对象 |
| `target.connectionId` | string | 是 | 店铺查询返回的中台连接ID，非空且最长150字符；不是虾皮数字 `shop_id` |
| `target.country` | string | 是 | 两位大写代码，如 `PH`、`SG`，必须与店铺实际市场一致 |
| `target.language` | string | 否 | 省略时使用目标店铺默认语言； 非空，最长80字符，必须是所选店铺supportedLanguages中的原值，如English、ไทย、繁體中文；不接受en等代码、前后空格或任意字符串 |
| `target.publishing` | object | 是 | 目标市场发布资料，字段见3.2.5；与来源快照隔离保存，不接受原始Shopee任意请求透传 |

#### 3.2.2 图片与详情字段

以下字段位于product.media下。media可省略；提供时三个数组assets、variantImages、detailBlocks均须存在。

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| assets | object[] | 是 | 最多30项 |
| assets[].id | string | 是 | 商品内唯一，正则^[A-Za-z0-9_-]{1,100}$ |
| assets[].url | string | 是 | 公开HTTPS地址，最多2048字符 |
| assets[].role | string | 是 | gallery、detail、variant |
| assets[].sourceLanguage | string | 否 | 非空，最多80字符 |
| assets[].textInImage | string | 是 | unknown、none、present；仅为图片文字元数据 |
| variantImages | object[] | 是 | 最多100项 |
| variantImages[].sku | string | 是 | 引用variants中已有SKU；每SKU最多一项 |
| variantImages[].assetId | string | 是 | 引用assets[].id，非空，最多100字符 |
| detailBlocks | object[] | 是 | 最多40项，顺序保留 |
| detailBlocks[].type | string | 是 | text或image |
| detailBlocks[].text | string | type=text时是 | 非空，单块及全部文字总和最多20000字符；不得同时传assetId |
| detailBlocks[].assetId | string | type=image时是 | 引用assets[].id，非空，最多100字符；不得同时传text |

#### 3.2.3 关联约束

1. variants[].options长度等于specificationNames长度，按下标对应；无规格时均为[]，variants仍至少一项。
2. SKU和规格组合均须在商品内唯一；导入时即校验。无规格商品只能包含一个SKU。
3. images为展示图顺序，首项为主图。role=gallery的URL须同时存在于images；详情图和规格图不自动加入images。
4. 目标保存按首层规格配图：同一首层选项须使用相同图片；提供配图时须覆盖全部首层选项。此项在保存前校验。
5. 图片须可由服务端下载，来源可使用PNG、JPEG、WebP；中台上传虾皮前将WebP转JPEG，不接收image_id、base64、本地路径、带账号密码/显式端口的URL或内网地址。下载阶段拒绝重定向、非图片内容和超过8MB的文件。提供可直接下载的HTTPS URL，不依赖Cookie或额外鉴权请求头；URL须在任务完成前持续有效。
6. textInImage不触发图片像素翻译；详情文字与图片为独立输入。
7. target.country须与店铺region一致，target.language须在该店铺supportedLanguages中；币种来自店铺，不接受target.currency。非法语言不会创建草稿或启动生成。
8. sourceSystem须与令牌配置一致；sourceProductId不是远端商品ID。
9. 导入限制是统一约束，不代表符合所有地区的目标保存规则。

#### 3.2.4 完整请求示例

以下为标准发送层双规格4SKU测试数据，不要求发送目标类目、属性、品牌或物流ID；来源类目路径为mock语义示例，不代表与目标类目已有验证的映射。connectionId需替换为查询返回的获准值；图片和商品均为mock，不用于销售。示例只包含本接口实际接受的字段。

```json
{
  "schemaVersion": 1,
  "requestId": "simulation-full-mock-ph-20261113-001",
  "product": {
    "schemaVersion": 1,
    "sourceSystem": "simulation",
    "sourceProductId": "mock-shoe-storage-full-001",
    "title": "API Integration Test - Not For Sale",
    "description": "This complete mock shoe storage box is used only to test the Shopee integration API. Color options: White and Blue. Size options: Small and Large. Each combination has its own SKU, final PHP price and zero inventory. Mock material: plastic; mock pattern: plain; mock storage feature: with lid. Mock capacity: four shoes. Package measurements for the test are 20 x 12 x 8 cm, gross weight 0.2 kg. The drawings are illustrative test images, not photographs of a real product. No certification, warranty or performance claims are provided. Do not publish or purchase this integration test record.",
    "images": [
      "https://cf.shopee.ph/file/sg-11134201-825av-mvh8mtinrpc6e6",
      "https://cf.shopee.ph/file/sg-11134201-8259j-mvh8mtrlik8x92",
      "https://cf.shopee.ph/file/sg-11134201-825av-mvh8mu0i1tz99f"
    ],
    "parameters": {
      "Material": "Plastic (mock)",
      "Pattern": "Plain (mock)",
      "Brand": "NoBrand (mock)",
      "Storage Feature": "With Lid (mock)",
      "Dimension (L x W x H)": "20 x 12 x 8 cm (mock)",
      "Number of Shoes": "4 (mock)",
      "Custom Product": "No (mock)",
      "Test notice": "All values and images are mock fixtures. Not for sale.",
      "类目": "家居用品 > 收纳用品 > 鞋盒",
      "品牌": "无品牌"
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
      },
      {
        "sku": "MOCK-NOT-FOR-SALE-BLUE-SMALL",
        "options": [
          "Blue",
          "Small"
        ],
        "stock": 0
      },
      {
        "sku": "MOCK-NOT-FOR-SALE-BLUE-LARGE",
        "options": [
          "Blue",
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
    },
    "media": {
      "assets": [
        {
          "id": "main",
          "url": "https://cf.shopee.ph/file/sg-11134201-825av-mvh8mtinrpc6e6",
          "role": "gallery",
          "sourceLanguage": "English",
          "textInImage": "present"
        },
        {
          "id": "white",
          "url": "https://cf.shopee.ph/file/sg-11134201-8259j-mvh8mtrlik8x92",
          "role": "gallery",
          "sourceLanguage": "English",
          "textInImage": "present"
        },
        {
          "id": "blue",
          "url": "https://cf.shopee.ph/file/sg-11134201-825av-mvh8mu0i1tz99f",
          "role": "gallery",
          "sourceLanguage": "English",
          "textInImage": "present"
        },
        {
          "id": "detail",
          "url": "https://cf.shopee.ph/file/sg-11134201-825b0-mvh8muapn66c64",
          "role": "detail",
          "sourceLanguage": "English",
          "textInImage": "present"
        }
      ],
      "variantImages": [
        {
          "sku": "MOCK-NOT-FOR-SALE-WHITE-SMALL",
          "assetId": "white"
        },
        {
          "sku": "MOCK-NOT-FOR-SALE-WHITE-LARGE",
          "assetId": "white"
        },
        {
          "sku": "MOCK-NOT-FOR-SALE-BLUE-SMALL",
          "assetId": "blue"
        },
        {
          "sku": "MOCK-NOT-FOR-SALE-BLUE-LARGE",
          "assetId": "blue"
        }
      ],
      "detailBlocks": [
        {
          "type": "text",
          "text": "Complete mock SKU matrix: White Small PHP 10; White Large PHP 12; Blue Small PHP 15; Blue Large PHP 18. Every SKU has zero stock and is not for sale."
        },
        {
          "type": "image",
          "assetId": "detail"
        },
        {
          "type": "text",
          "text": "Mock package: 20 x 12 x 8 cm; gross weight 0.2 kg. No physical product is offered. Keep this test item unlisted."
        }
      ]
    }
  },
  "target": {
    "connectionId": "REPLACE_WITH_AUTHORIZED_CONNECTION_ID",
    "country": "PH",
    "language": "English",
    "publishing": {
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
        },
        {
          "sku": "MOCK-NOT-FOR-SALE-BLUE-SMALL",
          "price": 15,
          "stock": 0
        },
        {
          "sku": "MOCK-NOT-FOR-SALE-BLUE-LARGE",
          "price": 18,
          "stock": 0
        }
      ],
      "condition": "NEW",
      "preOrder": {
        "isPreOrder": false
      }
    }
  }
}
```

#### 3.2.6 成功响应

HTTP 201，结构见第4节。初次通常为localizing；相同请求重放返回原记录的当前状态。

```json
{
  "id": "9e1769c0-c340-5f48-a351-cde7f40c1cc0",
  "requestId": "simulation-full-mock-ph-20261113-001",
  "status": "localizing",
  "sourceId": "38aff86d-c628-5623-a24a-8ff0e2a7da10",
  "draftId": "671f0b2a-f06c-5321-a4aa-aac0e87a49dc",
  "reviewPath": "/tools/localization?draft=671f0b2a-f06c-5321-a4aa-aac0e87a49dc",
  "title": "API Integration Test - Not For Sale",
  "sourceSystem": "simulation",
  "sourceProductId": "mock-shoe-storage-full-001",
  "shopName": "Example PH Shop",
  "country": "PH",
  "language": "English",
  "createdAt": "2026-11-13T08:00:00.000Z",
  "publishTasks": [],
  "note": "已接收来源资料；请在中台核对文案、补齐市场信息并预览确认。导入不会发布商品。"
}
```

#### 3.2.5 目标发布资料字段

本节字段均在`target.publishing`下。接收时必须提供该对象及variants数组，每个SKU必须有最终售价和库存；发布适配仍检查目标店铺、类目和渠道规则。发布数据以本节结构化字段为准，不从描述或图片中猜测售价、库存、认证或参数。类目、品牌、属性和物流ID由中台适配，标准发送方不必提交。目标ID的查询与校验由中台内部完成，仿真不使用来源市场ID代替。

| 字段 | JSON类型 | 接收必填 | 发布条件与限制 |
| --- | --- | --- | --- |
| categoryId | integer | 否 | 发布须有目标市场可用末级类目；正安全整数。未提供可按来源类目名称尝试匹配，未可靠匹配则缺项 |
| brandId | integer | 否 | 非负安全整数；按目标类目规则和品牌候选校验；0仅在目标允许NoBrand时使用 |
| brandName | string | 否 | 非空，最长200字符；提供时须与目标候选品牌名称匹配，不能用文字绕过品牌ID校验 |
| attributes | object[] | 否 | 最多100项，id不重复；仅目标规则要求的属性为条件必填 |
| attributes[].id | integer | 数组项内是 | 正安全整数，目标属性ID |
| attributes[].values | object[] | 数组项内是 | 0—100项；目标必填属性发布时不得为空，按目标输入类型、候选、数量、单位规则填写 |
| attributes[].values[].id | integer | 否 | 非负安全整数，目标属性值ID；自由输入仅限目标允许时，不能自行使用0绕过候选限制 |
| attributes[].values[].value | string | 是 | 非空，最长1000字符，候选值对应文字或允许的真实自由输入 |
| attributes[].values[].unit | string | 否 | 非空，最长50字符；目标属性要求单位时条件必填 |
| logistics | object[] | 否 | 最多100项，id不重复；发布需至少一个目标店铺可用且enabled=true的渠道 |
| logistics[].id | integer | 数组项内是 | 正安全整数，目标渠道ID |
| logistics[].enabled | boolean | 数组项内是 | 是否启用该渠道 |
| logistics[].sizeId | integer | 否 | 正安全整数；渠道按档位计费时按目标size_list条件填写 |
| logistics[].shippingFee | number | 否 | 大于等于0；渠道要求卖家指定运费时条件必填，不以0代替未知运费 |
| logistics[].isFree | boolean | 否 | 是否由卖家承担运费；按渠道规则使用 |
| variants | object[] | 是 | 1—100项，须覆盖product.variants全部SKU且一一对应，无重复或外来SKU |
| variants[].sku | string | 数组项内是 | 与来源SKU原值完全一致，非空，最长100字符 |
| variants[].price | number | 数组项内是 | 大于0；目标店铺币种的最终售价，发布必需，并符合price_limit；不能用来源价或自动汇率值替代最终售价 |
| variants[].stock | integer | 数组项内是 | 非负安全整数，允许0；目标库存范围仍需校验；本值优先于product.variants[].stock |
| variants[].locationId | string | 否 | 非空，最长100字符；目标店铺要求指定仓位时条件必填。当前不提供多仓发现或单SKU多仓库存分配 |
| variants[].gtinCode | string | 否 | 接收格式为1—32位数字，保留前导零；真实发布时须为8、12、13或14位且校验位有效，并满足目标gtin_validation_rule；不能自动填00规避要求 |
| condition | string | 否 | NEW或USED；本次PH厨房套装省略保存成功并回读NEW；其他目标按规则判断，不能把该默认推广为所有商品事实 |
| preOrder | object | 否 | 预售/发货时效配置；按目标dts_limit规则判断，不能查明预售天数范围时阻断预售发布 |
| preOrder.isPreOrder | boolean | 对象内是 | 是否预售 |
| preOrder.daysToShip | integer | 否 | 正安全整数；目标规则要求时条件必填，不套用其他店铺默认值 |

`publishing.variants`必须提供所有SKU的最终售价及库存，缺少任一项直接返回400。目标类目、属性、品牌和物流ID不要求仿真提供，由中台适配。不得通过AI编造缺失值。该扩展仅在市场草稿中保存，来源快照和其他国家版本的价格、类目、库存、物流互不影响。更换目标店铺后由中台重新读取对应规则，不复用旧目标ID。

### 3.3 查询导入记录

**GET https://commerce.aicbec.cn/api/v1/localization/integration/imports/{id}**

| 位置 | 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| path | id | string | 是 | 导入响应返回的记录UUID |

查询参数：无。请求体：无。

HTTP 200，响应结构见第4节。查询不触发生成。记录不存在或不属于当前接入方返回404；记录的来源系统授权不匹配时返回403。

### 3.4 重试文案生成

**POST https://commerce.aicbec.cn/api/v1/localization/integration/imports/{id}/localize**

| 位置 | 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| path | id | string | 是 | 导入响应返回的记录UUID |
| body | — | object | 否 | 使用{}，无可配置参数 |

HTTP 201，响应结构见第4节。

仅失败或内部待恢复状态启动重试；localizing、awaiting_review返回当前结果，不重复生成。草稿已有非失败发布任务，或失败任务含remoteId时，拒绝生成并返回409。服务中断后，查询将中断任务标记为localization_failed，须显式调用本接口恢复。

## 4. 导入记录响应

### 4.1 字段定义

| 字段 | 类型 | 必有 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 接收记录UUID，供查询和重试使用 |
| requestId | string | 是 | 调用方传入的幂等标识 |
| status | string | 是 | localizing、awaiting_review、localization_failed |
| localizationError | string | 否 | 文案失败或中断说明 |
| sourceId | string | 是 | 来源快照UUID |
| draftId | string | 是 | 目标草稿UUID |
| reviewPath | string | 是 | 页面相对路径/tools/localization?draft={draftId}，不含登录凭据 |
| title | string | 是 | 来源标题 |
| sourceSystem | string | 是 | 来源系统标识 |
| sourceProductId | string | 是 | 来源商品标识 |
| shopName | string | 是 | 目标店铺名称快照 |
| country | string | 是 | 当前草稿的目标地区 |
| language | string | 是 | 当前草稿语言 |
| createdAt | string | 是 | UTC ISO 8601接收时间 |
| publishTasks | object[] | 是 | 关联发布任务摘要，初次为空数组 |
| publishTasks[].id | string | 是 | 任务UUID |
| publishTasks[].status | string | 是 | preparing、creating、uncertain、created、completing、succeeded、failed |
| publishTasks[].stage | string | 是 | 阶段说明文本，不作为稳定枚举解析 |
| publishTasks[].remoteId | string | 否 | 已创建的远端商品ID，不代表发布成功 |
| publishTasks[].error | string | 否 | 任务错误说明 |
| note | string | 是 | 说明文本，不作为状态判断依据 |

### 4.2 状态定义

| status | 含义 | 处理方式 |
| --- | --- | --- |
| localizing | 文案生成中 | 查询原记录；建议间隔3–5秒，此为调用建议而非限流承诺 |
| awaiting_review | 文案生成完成 | 停止轮询文案状态；不等于商品已创建或发布 |
| localization_failed | 生成失败或中断，来源和草稿保留 | 修正条件后调用3.4，不重新导入 |

HTTP成功仅表示接口调用成功；导入status与publishTasks[].status分别表示文案状态和发布任务状态。

### 4.3 发布任务状态

| publishTasks[].status | 定义 |
| --- | --- |
| preparing | 检查目标要求并准备图片等资料 |
| creating | 正在请求创建商品 |
| uncertain | 创建结果不明确，须先核对远端，不能重新创建 |
| created | 已取得远端商品ID，后续操作未完成 |
| completing | 正在处理规格及后续操作 |
| succeeded | 发布任务完成 |
| failed | 任务失败；remoteId存在时表示已创建商品，不应重新创建 |

### 4.4 文案失败响应示例

HTTP 200。除以下字段外，其余字段与3.2.5一致：

```json
{
  "status": "localization_failed",
  "localizationError": "服务曾中断，草稿已保留，请主动重新生成文案。",
  "publishTasks": []
}
```

上例为字段片段，不是完整响应。调用3.4使用原记录id，不能使用sourceId或draftId代替。

## 5. 幂等与重试

| 场景 | 规则 |
| --- | --- |
| 作用域 | 同一接入方ID、绑定账号与requestId |
| 相同requestId、相同内容 | 返回同一id/sourceId/draftId及当前状态，不创建第二份草稿，不自动重试文案 |
| 相同requestId、不同内容 | HTTP 409，原记录不覆盖 |
| 内容比较 | 对象键顺序不影响比较；数组顺序、字段值及可选字段是否提供影响比较 |
| 超时、断网、5xx | 保留requestId及完整原请求重试，不改用新requestId |
| 更换店铺、地区或语言 | 新requestId；sourceSystem和sourceProductId可保持不变 |
| 修订来源内容 | 新requestId，不覆盖既有快照或草稿 |
| 文案失败 | 原id调用3.4，不重复导入 |

## 6. 地区差异与字段适用范围

### 6.1 统一结构与动态约束

第3节及附录Schema是中台接入结构，不等同于Shopee原始发布请求。connectionId决定目标店铺；country仅做一致性校验；language不改变店铺、币种或平台规则。真实条件必填字段由中台内部读取目标店铺、类目和物流规则判断，不复制来源市场ID，不把PH单店验证推广到其他市场。

| 发布资料 | 导入字段及类型 | 发布必填性 / 判定依据 |
| --- | --- | --- |
| 标题、描述 | product.title、description: string | 本地化后必须满足目标item_name_length_limit、item_description_length_limit；导入上限不等于上架上限 |
| 商品图片 | product.images: string[] | 发布需有效图片且符合目标数量、尺寸等限制；image_id由中台上传取得，不由仿真传入 |
| 目标类目 | target.publishing.categoryId: integer | 发布需目标可用末级类目；可接收来源类目文字进行匹配，未可靠匹配不能发布 |
| 类目属性 | target.publishing.attributes: object[] | 目标attribute_tree标为mandatory的属性条件必填；输入类型、候选值和单位按目标规则，不是所有属性都必填 |
| 品牌 | target.publishing.brandId、brandName | 按目标类目候选及规则校验，不能默认所有类目都允许NoBrand/0 |
| 规格 | product.specificationNames、variants[].options | 有规格时提交相应维度与选项，按目标长度/数量限制检查；无规格为一个SKU及空维度 |
| 各SKU最终售价 | target.publishing.variants[].price: number | 发布必需，大于0且符合目标price_limit，币种取店铺currency；不以汇率自动结果代替最终售价 |
| 各SKU库存 | target.publishing.variants[].stock: integer | 发布需非负整数并符合stock_limit；允许0；接收时必须显式提供target.publishing.variants[].stock，不能只传来源stock |
| 仓位 | target.publishing.variants[].locationId: string | 目标要求指定仓位时条件必填；不能套用PH默认仓位，多仓发现和分仓尚未完整支持 |
| 重量 | product.weightKg: number | 本接入契约必填，大于0，单位kg；同时满足目标/渠道规则 |
| 包裹长宽高 | product.dimensionsCm: object | 本接入契约必填，三个维度完整且大于0，单位cm；这是完整资料提交要求，不宣称所有Shopee市场均强制输入尺寸 |
| 物流渠道 | target.publishing.logistics: object[] | 发布需目标可用启用渠道，不能用parameters["物流"]文字代替渠道ID |
| 物流档位/运费 | logistics[].sizeId、shippingFee、isFree | 目标渠道计费方式要求时条件必填，按fee_type及size_list判断；0运费必须是真实确认值 |
| 成色 | target.publishing.condition: string | 使用目标允许值；省略时中台不显式发送condition，不虚构全新事实 |
| 预售/发货天数 | target.publishing.preOrder | 按目标dts_limit等规则条件填写；预售天数范围缺失时阻断，不复用其他店铺默认值 |
| GTIN | target.publishing.variants[].gtinCode: string | 按目标gtin_validation_rule条件必填；发布时校验8/12/13/14位长度及校验位，不得填虚构编码或默认00掩盖 |
| 税务、认证、尺码表等 | 尚未定义 | 目标市场/类目要求时不能绕过；超出现有支持范围须先补适配，不能承诺可发布 |

### 6.1.1 审核提示与平台必填的边界

`marketConfirmed`、`imagesReviewed`是中台历史审核状态，不是Shopee字段，不要求仿真提交，也不将它们作为Shopee必填缺项。图片中的文字核对是预览提醒，文本翻译不会修改图片像素。运营仍需主动确认发布，接收接口不会创建真实商品。

接收时先校验完整商品资料，缺少价格、库存、重量或包装尺寸直接拒绝。目标类目及品牌、属性、物流由中台适配；未可靠匹配或目标条件超出已支持范围时明确提示并阻止发布。不得为了让校验通过而猜测或补造商品事实。

### 6.2 PH目标参数示例

适用范围：PH店铺618217104、类目101255。历史保存测试为2026-11-13；2026-11-17再次真实只读查询get_item_limit确认重量和长宽高必填、非预售发货天数及以下通用范围。下表不是3.2导入参数校验规则，不适用于其他国家、店铺或类目；保存前重新查询。

| 参数 | 目标约束 |
| --- | --- |
| 币种 | PHP |
| 标题长度 | 20–100 |
| 描述文字长度 | 100–3000 |
| 展示图数量 | 1–9 |
| 规格名称长度 | 1–14 |
| 规格选项长度 | 1–20 |
| 每SKU售价 | 5–200000 PHP |
| 每SKU库存 | 0–10000000，integer |
| 重量 | 2026-11-17真实读取weight_limit.weight_mandatory=true，此店发布必填；历史测试0.2kg保存成功 |
| 包裹长宽高 | 2026-11-17真实读取dimension_limit.dimension_mandatory=true，此店三项必填；历史测试20×12×8cm保存成功；不是全球统一结论 |
| 图文详情文字总长度 | 100–3000 |
| 图文详情图片数量 | 1–12 |
| 详情图最小宽度/高度 | 700px / 32px |
| 详情图宽高比 | 0.5–32 |
| 非预售发货天数 | 2026-11-17真实读取dts_limit.non_pre_order_days_to_ship=1；历史保存未显式提交，回读为1；预售天数范围未知时不允许预售发布 |
| 仓位 | 本次未显式提交，回读默认PHZ；不作为其他店铺默认值 |
| 品牌 | 本次目标候选NoBrand的brand_id=0 |
| 物流 | 历史保存测试启用logistic_id=40029；本次可用店铺渠道另行读取，不把历史商品开关当成店铺默认值 |

2026-11-17真实只读查询get_channel_list返回已启用渠道及enabled、force_enable、fee_type=SIZE_INPUT、weight_limit、item_max_dimension等店铺规则。由中台读取并据商品包装筛选/组装，不要求仿真填写物流ID。渠道启用不等于任意商品都能使用；已上线按真实渠道限制自动带入；无法确定档位、运费或包装不满足限制时阻止发布并提示缺项。

目标类目属性示例：

| 属性 | attribute_id | 本次类目必填 | 值类型/候选示例 |
| --- | --- | --- | --- |
| Material | 100134 | 否 | 候选：value_id=1207，Plastic |
| Pattern | 100162 | 否 | 自由文字：value_id=0，Plain |
| Brands | 100276 | 否 | 自由文字：value_id=0，NoBrand；不代替brand.brand_id |
| Storage Feature | 100827 | 否 | 候选：value_id=4379，With Lid |
| Dimension (L x W x H) | 100942 | 否 | 自由文字：value_id=0，20 x 12 x 8 cm |
| Number of Shoes | 100958 | 否 | 候选：value_id=5030，4 |
| Custom Product | 101219 | 否 | 候选：value_id=7222，No |

这些属性ID和值ID仅用于说明本次PH目标映射。接入可用parameters传来源事实，或在target.publishing.attributes传已查明的目标ID和值；其他类目的必填项按目标attribute_tree重新判断。示例中的属性均为可选，因此attributes: []本身不构成此类目的必填缺失；此前将其直接判为不完整的说法不正确。其他类目仍需独立读取mandatory。

### 6.2.1 当前仿真英文厨房套装的真实接口验证

2026-11-17，Home Monitor_PH（shop_id=618217104），中台英文草稿9a82ae14-aaa1-55df-ae0a-d1488711371b，目标候选类目101226（Spatulas & Cooking Tweezers）。原始接收记录及草稿保持原值，补值只用于本次独立UNLIST保存验证。

| 接口/真实返回 | 处理 | 责任 |
| --- | --- | --- |
| media_space/upload_image：image is invalid or not supported | 来源WebP转JPEG，6张真实图片均上传成功 | 中台图片格式适配，不要求仿真重传JPEG |
| add_item：CategoryId is required | 匹配目标末级类目101226 | 中台适配，不要求仿真传目标ID |
| add_item：PackageLength / PackageWidth / PackageHeight is required | 分别补mock 30 / 15 / 10 cm | 仿真提供真实包装三维；本次值仅用于测试 |
| add_item：BrandId is required | 目标品牌NoBrand/0 | 中台按约定与目标候选适配 |
| add_item：Stock is required | 两款SKU各1 | 仿真应提供库存；本次按用户给定 |
| add_item：original_price … must Not Null | 两款SKU各999 PHP | 仿真提供目标币种最终售价；本次为mock |
| add_item：At least one shipping channel must be enabled | 从店铺已启用渠道带入40029及enabled=true | 中台负责；店铺已配置不等于创建请求可省略物流 |

结果：add_item成功，item_id=51121732523；init_tier_variation成功并延迟回读到WOOD-SET-5 / WOOD-SET-7，两款价格999 PHP、库存1、各自规格图及30×15×10cm包裹均匹配。最终回读UNLIST，未调用公开上架。创建成功请求未包含condition、GTIN、location_id、pre_order，attribute_list=[]；此目标类目get_attribute_tree全部mandatory=false。未发现此次商品额外税务、认证、属性必填要求；不将这一结果外推其他类目或市场。

本次只验证来源图转换后上传、展示图、英文商品资料、规格图和两款规格的未上架保存。上传了详情图，但创建请求未提交extended_description，本次结果不代表图文详情已写入，也不代表UI一键路径或公开上架已验证。

### 6.3 Shopee保存参数映射

下表为中台到Shopee的字段映射。外部请求只使用3.2定义的结构，不透传任意Shopee字段。字段类型结合历史真实请求与回读核对；新增可选字段尚未完成各市场真实写入验证。

| 导入输入/中台补齐项 | Shopee字段 | 请求类型 | 条件及映射 |
| --- | --- | --- | --- |
| 本地化标题 | item_name | string | 目标保存前必填 |
| 卖点及描述 | description | string | 按顺序合并，校验目标长度 |
| target.publishing.categoryId | category_id | integer | 目标末级类目，或中台可靠匹配所得；不取来源市场ID |
| target.publishing.brandId / brandName | brand.brand_id / original_brand_name | integer / string | 按目标候选及规则校验 |
| target.publishing.attributes[].id | attribute_list[].attribute_id | integer | 按目标mandatory条件补齐 |
| 属性值 | attribute_list[].attribute_value_list[].value_id | integer | 目标候选ID；允许自由文字的属性本次传0 |
| 属性值文字 | attribute_list[].attribute_value_list[].original_value_name | string | 对应候选名称或自由文字 |
| target.publishing.variants[].price | original_price | number | 单SKU最终售价，使用店铺币种 |
| 单SKU库存 | seller_stock[].stock | integer | 来源stock或中台确认值；多规格创建阶段先传0，再逐model设置 |
| weightKg | weight | number | 公斤；回读可能返回字符串，如"0.2"，不改变请求类型 |
| dimensionsCm.length/width/height | dimension.package_length/package_width/package_height | 本次为integer | 单位厘米；来源允许number，非整数厘米需按目标规则确认，不静默截断 |
| target.publishing.logistics[].id / enabled | logistic_info[].logistic_id / enabled | integer / boolean | 目标可用渠道 |
| logistics[].sizeId / shippingFee / isFree | logistic_info[].size_id / shipping_fee / is_free | integer / number / boolean | 按目标渠道条件填写 |
| images | image.image_id_list | string[] | 先上传URL对应图片，再使用平台返回的image_id；顺序保留 |
| media.detailBlocks | description_type | string | 有详情块时传extended |
| 详情块 | description_info.extended_description.field_list | object[] | 顺序保留；另在首项加入合并卖点与描述 |
| 文字块 | field_list[].field_type / text | string / string | field_type=text |
| 图片块 | field_list[].field_type / image_info.image_id | string / string | field_type=image；assetId映射到上传图片ID |
| 中台创建追踪标识（非仿真必填） | item_sku | string | 主商品货号不是Shopee上架必填；当前中台主动写入LOC-…用于创建结果核对，不能据此判定其必填 |
| target.publishing.condition | condition | string | NEW或USED；本次PH厨房套装省略仍保存成功，回读NEW；不能推广至所有市场 |
| target.publishing.preOrder | pre_order | object | is_pre_order / days_to_ship按目标规则提交 |
| target.publishing.variants[].gtinCode | gtin_code | string | 目标规则要求时提交；多规格按model对应 |
| 保存状态 | item_status | string | 创建阶段UNLIST，不等于已发布 |

### 6.4 多规格参数映射

先创建商品取得item_id，再初始化规格。所有规格、SKU、售价、库存和配图须完整提交。

| 字段 | 请求类型 | 条件及映射 |
| --- | --- | --- |
| item_id | integer | 上一步返回的Shopee商品ID，不是sourceProductId |
| standardise_tier_variation | object[] | 与specificationNames维度一致 |
| [].variation_name | string | 本地化后的规格名称 |
| [].variation_id / variation_group_id | integer | 本次自定义规格初始化均传0；不能复制其他市场ID |
| [].variation_option_list | object[] | 每维选项去重且保留出现顺序 |
| [].variation_option_list[].variation_option_name | string | 对应本地化后的options值 |
| [].variation_option_list[].variation_option_id | integer | 本次自定义选项传0 |
| [].variation_option_list[].image_id | string | 首层选项使用variantImages关联图片上传ID；第二层不设置配图 |
| model | object[] | 每SKU一个对象 |
| model[].model_sku | string | 来源variants[].sku |
| model[].tier_index | integer[] | 对应每维选项的零基下标；与options维度、顺序一致 |
| model[].original_price | number | target.publishing.variants[].price，各SKU最终店铺币种价格 |
| model[].seller_stock[].stock | integer | 每SKU独立库存 |
| model[].seller_stock[].location_id | string | target.publishing.variants[].locationId；历史PH测试未传，不能假定其他店铺可省略 |
| model[].gtin_code | string | target.publishing.variants[].gtinCode；按目标规则条件填写 |

本请求示例对应的目标规格矩阵：

| sku | Color | Size | tier_index | 最终价示例(PHP) | stock | 配图assetId |
| --- | --- | --- | --- | --- | --- | --- |
| MOCK-NOT-FOR-SALE-WHITE-SMALL | White | Small | [0,0] | 10 | 0 | white |
| MOCK-NOT-FOR-SALE-WHITE-LARGE | White | Large | [0,1] | 12 | 0 | white |
| MOCK-NOT-FOR-SALE-BLUE-SMALL | Blue | Small | [1,0] | 15 | 0 | blue |
| MOCK-NOT-FOR-SALE-BLUE-LARGE | Blue | Large | [1,1] | 18 | 0 | blue |

价格由target.publishing.variants[].price进入目标草稿，不写入product来源快照。回读model数组顺序可能变化，应按model_sku和tier_index核对，不按返回下标匹配。

### 6.5 支持范围及未验证项

新增目标售价、目标类目/属性/品牌ID、物流渠道/档位/运费、单仓位、成色、预售与GTIN接入结构。它们只作用于所选目标版本，不允许跨市场直接套用ID。新增结构已部署生产，原专用令牌继续有效。

BR、MX、CO、CL当前因地区税务等附加字段尚未适配，在发布校验中明确阻断；查询店铺、接收资料或生成文案成功不表示这些地区已能发布。

当前未完整支持：global_product及其商家级授权、逐SKU包裹、单SKU多仓库存分配及仓位发现、属性依赖的完整解析、税务/认证/监管字段、complaint_policy、size_chart等。条件要求超出现有支持范围时必须阻断发布或提示尚未支持，不能省略目标必填项，也不能追加未知字段绕过。

历史真实保存证据仅覆盖本文PH指定测试店铺/商品。其他市场未完成同等真实写入验证；新增字段的类型检查和模拟测试不等于Shopee真实接受。不能据此承诺所有国家、所有类目“无遗漏”。

## 7. 错误响应

### 7.1 响应格式

完整性拒绝示例（不创建接收记录或草稿）：

```json
{
  "code": "HTTP_400",
  "message": "商品资料不完整：target.publishing.variants[0].price：必须提供大于0的目标币种最终售价",
  "fieldErrors": [
    {"field": "target.publishing.variants[0].price", "message": "必须提供大于0的目标币种最终售价"}
  ],
  "requestId": "17e608f3-0c01-4c38-a897-7b3e5dd59e84"
}
```

应用异常处理器返回示例：

```json
{
  "code": "HTTP_409",
  "message": "requestId 已用于其他内容，请使用新的 requestId",
  "requestId": "17e608f3-0c01-4c38-a897-7b3e5dd59e84"
}
```

| 字段 | 类型 | 必有 | 说明 |
| --- | --- | --- | --- |
| code | string | 应用异常是 | HTTP_400等；上游异常可能是平台错误码，不固定为HTTP_502 |
| message | string | 是 | 错误说明，不作为稳定错误码 |
| requestId | string | 否 | 本次HTTP追踪ID，对应X-Request-Id，与导入幂等requestId不同 |
| fieldErrors | object[] | 否 | 商品完整性错误清单，每项包含field:string（JSON字段路径）和message:string；请求被拒绝，不落记录 |
| diagnostic | object | 否 | 脱敏平台诊断，不含凭据 |
| diagnostic.upstreamCode | string | diagnostic存在时是 | 平台错误码；未匹配安全白名单时为unknown |
| diagnostic.upstreamRequestId | string | 否 | 经格式校验的上游请求追踪ID |

代理、来源检查和请求体解析拒绝可能只返回message或非JSON内容；以HTTP状态为首要判断依据。

### 7.2 状态码

| HTTP | 典型原因 | 处理方式 |
| --- | --- | --- |
| 400 | 缺售价/库存/重量/包装长宽高、空描述或无商品图、版本/字段无效、图片格式不符、重复规格组合、语言不在supportedLanguages、店铺不可用或国家不匹配 | 修正参数；查询店铺取得有效语言值 |
| 401 | 令牌缺失/无效、接入未配置/停用、携带Origin/Cookie | 检查专用令牌和请求头 |
| 403 | sourceSystem不匹配、来源授权撤销、来源检查拒绝 | 检查sourceSystem、接入配置及调用方式 |
| 404 | 记录不存在、ID无效或记录不属于接入方 | 核对记录id和身份 |
| 409 | requestId内容冲突，或已有发布任务阻止生成 | 保留原记录，按冲突原因处理 |
| 413 | 代理返回的请求体大小超限 | 缩小请求，不嵌入图片内容；应用解析阶段错误可能以500返回 |
| 502 | 上游平台读取失败 | 按原请求重试，保留追踪ID |
| 500及其他5xx | 服务暂不可用或未处理错误 | 按原requestId及内容重试 |

localization_failed是记录状态，不是HTTP错误；查询该记录仍可返回200。

## 8. 调用示例

API_BASE=https://commerce.aicbec.cn，SOURCE_SYSTEM=simulation；专用令牌以LOCALIZATION_TOKEN注入服务端环境，不写入本文。SOURCE_SYSTEM用于JSON的product.sourceSystem，不作为请求头。将3.2.4的JSON保存为request.json并替换示例值；IMPORT_ID填写导入返回的id。

### 8.1 查询店铺

```sh
curl --request GET "$API_BASE/api/v1/localization/integration/shops" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN"
```

### 8.2 导入商品

```sh
curl --request POST "$API_BASE/api/v1/localization/integration/imports" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary @request.json
```

### 8.3 查询记录

```sh
curl --request GET "$API_BASE/api/v1/localization/integration/imports/$IMPORT_ID" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN"
```

### 8.4 重试文案

```sh
curl --request POST "$API_BASE/api/v1/localization/integration/imports/$IMPORT_ID/localize" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{}'
```

## 附录A. 请求JSON Schema

JSON Schema Draft 2020-12。用于结构校验；SKU唯一、规格维度、素材引用、店铺连接状态和country一致性仍由服务端检查。Schema不定义各地区Shopee发布必填项。

<details>
<summary>完整请求Schema</summary>

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Localization import v1",
  "description": "仿真完整商品接入契约：售价、库存、包装重量尺寸必填；目标类目及可复用的店铺配置由中台适配。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "requestId",
    "product",
    "target"
  ],
  "properties": {
    "schemaVersion": {
      "const": 1
    },
    "requestId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$"
    },
    "product": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "sourceSystem",
        "sourceProductId",
        "title",
        "description",
        "images",
        "parameters",
        "specificationNames",
        "variants",
        "weightKg",
        "dimensionsCm"
      ],
      "properties": {
        "schemaVersion": {
          "const": 1
        },
        "sourceSystem": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "sourceProductId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 150
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "description": {
          "type": "string",
          "maxLength": 20000,
          "minLength": 1
        },
        "images": {
          "type": "array",
          "maxItems": 9,
          "items": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://",
            "maxLength": 2048
          },
          "minItems": 1
        },
        "parameters": {
          "type": "object",
          "maxProperties": 100,
          "propertyNames": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "additionalProperties": {
            "type": "string",
            "maxLength": 1000
          }
        },
        "specificationNames": {
          "type": "array",
          "maxItems": 2,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "variants": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "sku",
              "options"
            ],
            "properties": {
              "sku": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              "options": {
                "type": "array",
                "maxItems": 2,
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 100
                }
              },
              "stock": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            }
          }
        },
        "weightKg": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "dimensionsCm": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "length",
            "width",
            "height"
          ],
          "properties": {
            "length": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "width": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "height": {
              "type": "number",
              "exclusiveMinimum": 0
            }
          }
        },
        "media": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "assets",
            "variantImages",
            "detailBlocks"
          ],
          "properties": {
            "assets": {
              "type": "array",
              "maxItems": 30,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "url",
                  "role",
                  "textInImage"
                ],
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^[A-Za-z0-9_-]{1,100}$"
                  },
                  "url": {
                    "type": "string",
                    "format": "uri",
                    "pattern": "^https://",
                    "maxLength": 2048
                  },
                  "role": {
                    "enum": [
                      "gallery",
                      "detail",
                      "variant"
                    ]
                  },
                  "sourceLanguage": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80
                  },
                  "textInImage": {
                    "enum": [
                      "unknown",
                      "none",
                      "present"
                    ]
                  }
                }
              }
            },
            "variantImages": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "sku",
                  "assetId"
                ],
                "properties": {
                  "sku": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  },
                  "assetId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  }
                }
              }
            },
            "detailBlocks": {
              "type": "array",
              "maxItems": 40,
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "type",
                      "text"
                    ],
                    "properties": {
                      "type": {
                        "const": "text"
                      },
                      "text": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 20000
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "type",
                      "assetId"
                    ],
                    "properties": {
                      "type": {
                        "const": "image"
                      },
                      "assetId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 100
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    },
    "target": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "connectionId",
        "country",
        "publishing"
      ],
      "properties": {
        "connectionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 150
        },
        "country": {
          "type": "string",
          "pattern": "^[A-Z]{2}$"
        },
        "language": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "description": "使用目标店铺查询响应supportedLanguages中的原值，区分大小写；不是ISO语言代码。"
        },
        "publishing": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "variants"
          ],
          "properties": {
            "categoryId": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            },
            "brandId": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "attributes": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "values"
                ],
                "properties": {
                  "id": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  "values": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "value"
                      ],
                      "properties": {
                        "id": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "value": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "unit": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 50
                        }
                      }
                    }
                  }
                }
              }
            },
            "logistics": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "enabled"
                ],
                "properties": {
                  "id": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  "enabled": {
                    "type": "boolean"
                  },
                  "sizeId": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  "shippingFee": {
                    "type": "number",
                    "minimum": 0
                  },
                  "isFree": {
                    "type": "boolean"
                  }
                }
              }
            },
            "variants": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "sku",
                  "price",
                  "stock"
                ],
                "properties": {
                  "sku": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  },
                  "price": {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  "stock": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "locationId": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  },
                  "gtinCode": {
                    "type": "string",
                    "pattern": "^[0-9]{1,32}$"
                  }
                }
              },
              "minItems": 1,
              "description": "提供时必须与product.variants的全部SKU一一对应且无重复；由服务端执行关联校验。price为目标店铺币种的最终售价。"
            },
            "condition": {
              "enum": [
                "NEW",
                "USED"
              ]
            },
            "preOrder": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "isPreOrder"
              ],
              "properties": {
                "isPreOrder": {
                  "type": "boolean"
                },
                "daysToShip": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 9007199254740991
                }
              }
            },
            "brandName": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            }
          },
          "description": "目标市场发布资料；目标ID由中台内部查询和适配，仿真无需提供。仅写入市场草稿，不改变来源快照。省略允许接收但不代表满足发布条件。"
        }
      }
    }
  }
}
```

</details>
