# 市场调研按店铺画像分析

目标：AI 选品分析可先选已授权 Shopee 店铺，自动生成店铺画像（主营类目、品牌），结构化条件默认不限，减少手写选品要求。
验收：新增店铺画像接口（只读 get_item_list/get_item_base_info/类目元数据，失败降级为提示）；分析接受 shopId 与 criteria（价格带、最低环比、最低佣金），先规则过滤再调用模型，提示词带店铺画像；选了店铺时自由文本选填；旧分析记录与重试兼容；跟卖默认选分析所用店铺。测试、类型、baseline 通过。
范围：apps/api/src/tools/selection/*、apps/api/test/selection-*.test.ts、apps/console/src/app/tools/selection/page.tsx、apps/console/src/lib/selection.ts。
非目标：改数据库结构、新增 Shopee 权限、订单/店铺表现数据、FastMoss 非马来西亚榜单、修改冻结路径。
假设：画像采样首页最多 100 个在售商品。
