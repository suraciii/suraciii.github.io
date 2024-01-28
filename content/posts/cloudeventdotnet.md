---
title: "CloudEventDotNet:基于.NET的事件发布订阅库"
date: 2023-09-08T00:00:00Z
draft: true
---

CloudEventDotNet可以帮助你在.NET中发布/订阅`CloudEvent`标准的事件，这个项目主要是受`Dapr`中的发布订阅组件启发而开发的。

## 特性

* 以`CloudEvent`格式发布和订阅事件
* 支持Apache Kafka和Redis Stream
* 具备最少一次投递保证
* 支持死信
* 可观测性支持 (链路/指标)
* **不支持**有序的事件消费

## 使用方式

### 安装包

```shell
dotnet add package CloudEventDotNet
dotnet add package CloudEventDotNet.Redis # 使用Redis Stream
dotnet add package CloudEventDotNet.Kafka # 使用Apache Kafka
```

### 配置

```csharp
services.AddCloudEvents(defaultPubSubName: "kafka", defaultTopic: "my-topic")
    .Load(typeof(OrderCancelled).Assembly)
    .AddKafkaPubSub("kafka", options => // 发布配置
    {
        options.ProducerConfig = new ProducerConfig
        {
            BootstrapServers = broker,
        };
    }, options => // 订阅配置，不配置则不开启订阅
    {
        options.ConsumerConfig = new ConsumerConfig
        {
            BootstrapServers = broker,
            GroupId = consumerGroup,
        };
    })
    .AddRedisPubSub("redis", options =>
    {
        options.ConnectionMultiplexerFactory = () => redis;
        options.MaxLength = maxLength;
    }, options => // 订阅配置，不配置则不开启订阅
    {
        options.ConnectionMultiplexerFactory = () => redis;
        options.ConsumerGroup = consumerGroup;
    });
```

#### 定义CloudEvent

```csharp
[CloudEvent] // 使用默认的PubSub名和Topic名注册事件
public record OrderCancelled(Guid OrderId, string Reason);
```

```csharp
[CloudEvent(PubSubName = "redis", Topic = "another-topic", Type = "a-custom-type")] // 指定事件相关属性
public record OrderCancelled(Guid OrderId, string Reason);
```

### 发布事件

```csharp
var pubsub = serviceProvider.GetRequiredService<ICloudEventPubSub>(); // 通过依赖注入获取组件
await pubsub.PublishAsync(new OrderCancelled(order.Id, reason));
```

### 订阅和处理事件

```csharp
public class OrderCancelledHandler : ICloudEventHandler<OrderCancelled>
{
    public async Task HandleAsync(CloudEvent<PingEvent> cloudEvent, CancellationToken token)
    {
        // ...
    }
}
```

### 性能

在一个4*2.4GHz Core的容器中

|           | Kafka   | Redis  |
|-----------|---------|--------|
| Publish   | ~100k/s | ~90k/s |
| Subscribe | ~150k/s | ~40k/s |


## 后续

这个库虽然是围绕`CloudEvent`标准做的，可以兼容其它支持`CloudEvent`的组件（如Dapr等），但是感觉以SDK的形式来发布订阅事件还是有些不方便，它有一些优点，比如它是在应用本地进行消费，可以随应用伸缩，但是还是觉得有些问题：
1. 比如尽管链路追踪提供了一些故障诊断上的帮助，但是在对事件进行溯源或者检索时依旧很困难
2. 另外对于非.NET应用，寻找一个合适的支持`CloudEvent`的组件还是比较困难（Dapr的引入成本稍微有些高，此外Dapr的发布订阅性能也有很大问题）
3. 此外使用SDK消费时，只能根据Topic进行路由，即应用必须拉取相关Topic下的所有事件，尽管可能其中90%的事件都是它不需要的

所以后续想尝试下看能不能做一个服务化的事件中心（类似Dapr），提供更细致的事件路由，提供事件的检索和管理功能等，提供通用的HTTP/GRPC API，来解决上面的问题


