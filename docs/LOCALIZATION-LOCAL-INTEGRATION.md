# 商品本地化：本地仿真联调

## 环境

运行 `pnpm dev` 后，本地机器接入地址为 `http://127.0.0.1:3100`。Next 将 `/api/*` 转发到本机 Nest `127.0.0.1:4100`，不会把仿真商品请求转发到中央生产服务。

本地联调令牌由启动脚本首次运行时生成，保存在项目私密目录：

`.local/localization-integration/local-simulation-delivery.txt`

通过项目根目录相对路径访问为 `.local/localization-integration/local-simulation-delivery.txt`。这个文件只用于本地环境，不能替代生产交付令牌。不要把令牌放入浏览器代码、URL、Git 或日志。

## 店铺与数据

新接入按[标准接口文档](LOCALIZATION-INTEGRATION.md)的schemaVersion:2提交完整商品及publishing；不传target、店铺ID、国家或语言，不需要查询店铺接口。旧v1接口仅作兼容。

界面从真实中央授权服务读取当前账号可用店铺，目标店铺和语言由运营在中台选择。机器接入旧店铺查询中出现的local-sim-ph是v1历史测试夹具，不代表真实授权，也不要将其带到生产请求。

本地来源、市场版本、任务和图片保存在`.local/localization`，不要作为缓存清理。中央接收记录持续同步、不支持删除；打开中央商品时，服务端读取原文快照和已提供的最终价格，并把受认证图片安全保存为本地副本。本地转译、审核不会修改生产草稿。

本地仿真提交记录与中央接收记录按来源区分；只展示实际POST产生的记录，不在启动时制造样例。用户在“一键上架”审核或在“商品本地化”选择目标国家店铺和语言。市场资料读取使用已有中央链路；本地模式在服务端阻止真实图片上传、商品创建、补全和发布。

## 接入配置

| 环境 | API_BASE | 专用令牌 |
| --- | --- | --- |
| 本地 | http://127.0.0.1:4100 | `.local/localization-integration/local-simulation-delivery.txt` |
| 生产 | https://commerce.aicbec.cn | 使用单独安全交付且在生产启用的令牌 |

生产在部署本次v2前仍按旧v1运行，不要直接向旧生产发送v2。跨机器联调需要可访问的网关地址，127.0.0.1仅指调用方本机；不要直接暴露受Host/Origin保护的团队网关来绕过访问控制。

AI配置使用中台现有文本模型配置，密钥保留服务端。检查资料可能调用模型进行类目/真实参数匹配；仅生成文案按钮触发文字转译，图片像素不变。

## AI 请求等待时限

本地 Next 转发等待时限为150秒，高于文本模型单次请求的120秒时限，避免30秒代理默认超时后后台仍继续保存。网关返回非JSON错误时，页面提示先刷新已保存记录核对，禁止据此认定生成未发生或盲目重试。

## 内部市场规则查询（非仿真交付）

以下用于中台维护和排查，不属于仿真平台标准接入流程。相关市场资料查询与自动适配已部署生产。

### 3.5 查询目标市场规则与候选

**GET https://commerce.aicbec.cn/api/v1/localization/integration/shops/{id}/requirements?categoryId={categoryId}**

请求体：无。鉴权与其他接入接口相同，沿用专用Bearer令牌。

| 位置 | 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| 路径 | id | string | 是 | 3.1返回的目标店铺连接ID，必须在令牌授权范围且处于CONNECTED状态 |
| 查询 | categoryId | integer | 否 | 正整数，目标末级类目ID；未提供时返回类目/物流/限制，类目专属属性与品牌为空；选择类目后重新查询 |

| 响应字段 | JSON类型 | 说明 |
| --- | --- | --- |
| connectionId | string | 本次查询目标店铺 |
| categoryId | integer或null | 本次查询类目；未提供则为null |
| categories | object[] | 类目候选，含id、name、parentId、hasChildren；发布使用hasChildren=false的有效目标类目 |
| attributes | object[] | 所选类目属性候选，含id、name、required、values；required=true表示目标返回的必填属性，values含id和value |
| brands | object[] | 所选类目品牌候选，含id和name；仅在实际候选允许时使用NoBrand/0 |
| logistics | object[] | 目标物流候选，含id、name、enabled；详细计费和尺寸规则见rules.logistics |
| limits | object | 目标get_item_limit原始限制，包括返回的长度、数量、价格、库存、GTIN等规则；未返回的键不得视为无限制或无需填写 |
| rules.attributes | object或null | 目标get_attribute_tree原始响应，用于查看输入类型、单位、候选及其他规则 |
| rules.brands | object或null | 目标get_brand_list原始响应 |
| rules.logistics | object | 目标get_channel_list原始响应，查看fee_type、size_list、限重尺寸等渠道规则 |
| rules.limits | object | 与limits一致的原始限制 |
| capability / capabilities | object | 已查询的路径、权限与阻断原因；读取成功不等于写入资格已通过 |
| support.path | string | 当前适配路径product；不表示所有店铺均适用此路径 |
| support.unsupportedFeatures | string[] | 当前未完整支持的能力：global_product、tax_info、complaint_policy、size_chart、multi_warehouse_discovery、attribute_dependencies |
| fetchedAt | string | UTC规则读取时间，保存/发布前应重新查询 |

本接口为可选高级能力，标准仿真接入不需要调用。中台内部读取顺序：先查店铺，再不带categoryId查询类目，匹配目标类目后带categoryId查询属性和品牌；组装3.2.5对应市场草稿。要求超出support范围时不得省略字段强行提交。该端点返回规则与候选，不承诺覆盖全部地区、特殊类目和规则依赖，不是Shopee写入接口。

### 8.5 查询市场规则

```sh
curl --request GET "$API_BASE/api/v1/localization/integration/shops/$CONNECTION_ID/requirements?categoryId=$CATEGORY_ID" \
  --header "Authorization: Bearer $LOCALIZATION_TOKEN"
```

以下仅用于高级调用方排查规则，非仿真标准接入必做步骤。先用3.1取得CONNECTION_ID，不带categoryId查询类目后，再将实际目标末级类目ID设为CATEGORY_ID。新增接口和字段须待本次更新部署后才可在生产调用。


## 2026-11-17 自动适配验证状态

本地实现：按商品事实匹配目标末级类目；按来源参数匹配真实属性候选；匹配品牌或目标真实 NoBrand；按包裹限制筛选店铺已启用物流。保留人工编辑、市场隔离、适配失败可重试；适配本身不调用商品写入接口。

验证：113项测试、typecheck、build、verify:baseline、Diff Gate通过。真实本地HTTP读取中央店铺规则返回502“无法连接团队服务”，随后请求触发限流；真实自动适配未通过，不把模拟结果视作真实结果。生产新增字段及自动适配实现未部署。对外文档可用于开发对接，生产验收仍需部署后恢复规则查询并验证完整链路。

### 中央规则错误定位（2026-11-17）

只读核验线上当前编译文件与真实Shopee调用：线上开发网关仅接受category_id，并原样发给get_attribute_tree；Shopee HTTP200返回product.error_param及CategoryIdList is required，中央包装为HTTP502。服务器直接改用category_id_list调用同一店铺同一类目成功。类目、物流、发布限制、品牌接口本次均返回200。

生产审计记录UTC10:13该分钟共57次DEV_READ，其中品牌查询50次；UTC10:14又有3次已执行读取。线上开发接口按账号60次/60秒限流；属性与品牌并行导致属性失败后品牌分页继续执行。该统计不含在限流前被拒绝的请求，不能作为拒绝总数。

本地修复：属性成功后才读取品牌；单次适配品牌分页最多3页，未读完显式标记candidatesIncomplete，不冒充完整候选或把未命中判断为品牌不支持。生产网关类目参数映射修复已在本地代码中，未部署，本次未修改生产服务或商品。

## 2026-11-17 生产修复部署验收

新本地化版本20261117-adaptation-01，中央网关版本20261117-category-gateway-01已切换运行，保留原版本以便回滚。前述未部署、502和限流是修复前状态，已由本节结果取代。

- 公网健康检查、审核页面及原店铺页200；审核页12个、店铺页10个JS/CSS资源全部200。
- 原专用Bearer查询店铺200，缺Bearer为401；两种类目参数查询真实属性均200。
- 目标类目101226读取7个属性、300个品牌候选，NoBrand在真实候选内；超过3页明确提示候选未读完整。
- 现有英文接收请求原样重放201，返回原回执和原草稿；状态查询200，publishTasks为空。带新增售价/库存字段重放相同requestId得到409内容冲突，说明新增结构通过解析且没有覆盖既有资料。此次未新建接收记录。
- 英文草稿真实自动适配成功：类目101226、品牌0、物流4000；缺最终售价、库存和包装尺寸时保持needs_input，保留原文案和来源快照。
- 本次没有调用Shopee商品创建、修改或发布接口。此前UNLIST验证结果不等于本次完成公开发布验收。
- 114项测试、typecheck、build、verify:baseline及Diff Gate通过。令牌和配置未变，仿真继续使用原API_BASE/SOURCE_SYSTEM/Bearer。

## 2026-11-17 严格接收契约上线（取代此前不完整资料接收行为）

生产版本20261117-required-fields-02要求非空标题描述、至少1张商品图、正包装重量与完整正长宽高、全部SKU的正最终售价及非负整数库存。类目不必填，品牌/属性/物流ID继续由中台适配。缺项在任何来源/草稿/接收记录创建或AI调用之前返回400，错误包含fieldErrors数组，历史GET查询不受影响。

真实5组拒绝请求全部400，完整且无类目/零库存数据通过完整性检查后被已有requestId幂等冲突保护拒绝409；未创建测试接收记录。前后4接收记录、3来源、4草稿、0发布任务一致。旧不完整请求重新POST会400；补齐旧内容另用新requestId，防止覆盖历史快照。

## 本地真实上架

pnpm dev 默认连接中央服务并允许登录人员主动发布至已授权真实店铺；本地不保存 Shopee 密钥。检查通过后点击“一键上架”会真实写入，发布任务、幂等标识及恢复状态保存在本地。检查及转译本身不发布。需要只读模拟时在 .env.team 设置 LOCALIZATION_LOCAL_MODE=true；此时真实写入被服务端拒绝，按钮禁用。更改后重启 pnpm dev。
