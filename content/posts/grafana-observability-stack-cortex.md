---
title: 来自Grafana Labs的云原生可观测性全家桶之 Cortex
date: 2021-02-11T00:00:00Z
---

日志(logs)、指标(metrics)和分布式追踪(traces)被称作可观测性的三大支柱。我们通过一系列的工具和手段，对这些遥测信息进行收集、处理和分析，从而能够帮助我们更及时有效地响应故障和更有信心地发布新的功能。

Grafana Labs以其当家产品Grafana面板为人熟知，这里分别介绍一些Grafana Labs提供的可观测领域中的其它开源产品，并和一些其它同类产品进行简单的对比。

## Cortex

目前，Prometheus是当前常见且主流的指标监控解决方案，它能够收集指标信息并将其以时序数据保存，并支持服务发现、报警以及灵活的查询能力等，但是单纯使用Prometheus作为指标监控的解决方案，在当前有着一系列的局限：
* 无法水平扩展
* 非高可用
* 不能很好地支持多租户
* 不支持对多集群的指标采集
* 数据只能保存在本地硬盘中，随着数据规模的增长变得难以维护
这些问题都限制了Prometheus无法作为中心化、中台化的监控解决方案，而这又恰恰是我们所需要的

Cortex项目就是为了解决这些问题，为Prometheus增强其上面列出的所缺少的这些能力。
Cortex摄取来自各个Prometheus实例的数据，将其转储到对象存储（如s3、Azure Storage等）中——对象存储具备更高的扩展性，数据更易于维护、成本也要更低。
此外、Cortex也提供了指标数据的并行化查询和缓存，从而提高了查询性能。

下图为Cortex的整体架构：
![](/grafana-observability-stack/1.png)

Cortex的工作方式：
1. 各个**prometheus**实例通过`Remote Write`接口将采集到的指标数据发送到**distributor**
2. **distributor**在对指标数据进行一系列的检查校验后，将其分批、并行地发送到多个**ingester**中
3. **ingester**负责将收到的指标数据缓存并定时提交到对象存储中
4. **querier**负责指标数据的查询，它会分别从对象存储以及**ingester中同时进行查询**（因为最新的数据还在ingester中未被提交）
5. **query frontend**是一个可选的额外查询层面，它可以将查询命令按时间分片放入查询队列，并分别交由多个**queriers**并行地进行查询，然后再进行整合，并将查询结果进行缓存，从而提高查询效率。
6. **query scheduler**是一个可选的位于**query frontende**和**querier**之间的查询层，其主要是为了能够独立地对查询队列进行伸缩
7. **ruler**可以通过执行配置的查询来记录规则和警报，并将产生的警报发送给**alert manager**，将计算后的指标发送给**ingester**

其中，大多数组件都是无状态的，另外有部分（比如**ingester**）是依赖一致性哈希的有状态组件，这些组件都可以独立地进行水平伸缩。

#### 与Thanos对比

Thanos是另一个流行的给Prometheus加buff的方案，其作用和功能与Cortex类似，但是工作方式有所不同。

Thanos的设计非常简洁且优雅：
![](/grafana-observability-stack/2.png)

1. Thanos为每个prometheus实例添加一个**sidecar**，sidecar定时地将prometheus中的指标数据上传到对象存储中
2. **store gateway**负责对象存储中的指标数据的读取
3. **querier**负责执行PromQL查询，它会向**store gateway**、**sidecar**s以及其它**querier**中读取数据并进行聚合

可以看出，thanos的能力更侧重于“数据备份”和“视图整合”这两个方面，其查询层的设计使得可以非常方便地实现多集群的指标收集和查询，得益于其简洁的设计，部署和配置的复杂度也相对较低。
相比thanos，cortex的能力更为全面，比如：
* cortex支持通过API的形式配置指标规则和告警，这点对于没有很好地实践DevOps的团队来说更为友好
* 通过二者的查询实现可以看出，cortex的查询性能会相对来说更好一些
* cortex的水平扩展能力相对较高
* cortex对多租户的支持更完善一些（比如支持对每个租户的用量控制等）

