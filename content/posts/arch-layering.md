---
title: 浅谈架构设计之分层
date: 2022-05-13T00:00:00Z
---

*本文是某次分享的摘要*

### 架构分层

* 将复杂的系统分割成位于不同层次的模块
* 将实现细节隐藏在各个层面的模块中
* 降低认知负担，改动成本和风险

### 分层的原则

总结的三个主要原则：
* 不同的分层，建立不同的抽象
* 关注点分离
* 层内高内聚、层间低耦合

其它一些分层原则：
* 层与层之间不应有循环依赖
* 业务层不应该包括非业务代码，反之亦然
* 各层应能够独立测试
* 低层不应依赖高层
* 分层是逻辑上的抽象，不一定意味着物理上的分离

*这些分层原则主要来自于 1. 《A Philosophy of Software Design》 John Ousterhout, 2. 《LayeringPrinciples》 Martin Fowler*

### 三层架构

![](/arch-layering/3tiers.png)

人（前端/客户端）<-> 应用 <-> 数据库

![](/arch-layering/3layers.png)

* 展示层：人和应用的交互
* 数据层：应用对数据的存取
* 依赖方向从上至下

### 六边形架构

![](/arch-layering/hex.png)

* 核心层：应用逻辑
* 外层：UI、HTTP API、日志、配置、数据库、缓存、邮件通知等 - *虽然这些模块有着不同的关注点，但是在层次上是在同一层*
* 依赖方向：从左到右

### 存在的问题

![](/arch-layering/3layers-problem.png)

对于业务系统：
* 业务的数据结构和关系存在于数据库中，**业务逻辑和应用逻辑**混淆在一起
* 业务模型的**数据和行为分离**，导致认知负担及改动风险
* 基于数据库设计数据结构产生不准确的模型

### 领域驱动设计：四层架构

![](/arch-layering/4layers-1.png)

* 领域层：新的抽象
* 区分于应用层，领域层内由体现业务领域中的知识的同时具备数据和行为的领域模型构成，不包含和应用相关的代码

依赖反转——

![](/arch-layering/4layers-2.png)

* 应用层是控制面
* 领域层中是纯粹的领域模型
* 领域层不依赖基础设施，不关心应用逻辑

### 洋葱架构

![](/arch-layering/onion.png)

* 依赖流由外向内
* 以领域层中的领域模型为核心
* 核心领域模型专注于对业务领域进行抽象
* 首先建立领域模型，围绕领域模型建立数据库表结构，填充应用功能

#### 具备领域层的六边形架构

![](/arch-layering/hex-2.png)

#### 整洁架构

![](/arch-layering/clean.png)

### 总结

* 总体分为核心层和非核心层
* 应用层比较薄，不涉及业务逻辑和知识，只负责协调任务并将工作传递到下一层来处理
* **如无必要、勿增抽象** *层次越多，抽象越多，理解越困难*

### 纵向切分

* 主要关注于对模块边界的识别
* 在多个层面中分别进行
