---
title: .NET 7 预览
date: 2022-02-18T00:00:00Z
---

2月17日，.NET团队[发布了.NET 7的第一个预览版本](https://devblogs.microsoft.com/dotnet/announcing-net-7-preview-1/)，此时正值.NET发布20周年，距离[.NET 6的正式发布](https://devblogs.microsoft.com/dotnet/announcing-net-6/)才过了不到4个月，在这个预览版本里，没有特别重要的新特性，但是可以一窥.NET 7的一些规划和展望


### 现代客户端开发：.NET MAUI

[MAUI](https://github.com/dotnet/maui)是`Xamarin.Forms`的新（改名）版本，被看作是.NET跨平台原生UI开发的未来，其在BUILD 2020大会上宣布以来，至今已经发布了13个预览版本，将在今年第二季度发布支持.NET 6的正式版本，并在之后跟随.NET 7的发布正式成为.NET的一部分。

### 现代云原生应用

.NET 7将寻找对开发体验上的改进从而帮助开发者更轻松地开发云原生应用，例如：
* 简化实现身份认证和授权所需的设置和配置
* 改进应用的启动速度和运行时性能

.NET 7将在开发容器应用的体验上做出改进，包括：
1. 改进.NET镜像使其更小、更快、更安全
2. 增强遥测以改进容器的可观测性
3. 尝试通过dotnet SDK直接构建容器（我觉得这个还是蛮有用的，目前几乎所有语言/平台的工具链里都不包括容器镜像的构建，这在开发时挺不方便——比如需要安装docker环境等，需要维护繁杂的构建脚本、makefile等，即使有更轻量的podman等工具，也不如直接集成到语言/平台本身的工具链上来得方便）

### 帮助升级.NET应用

一方面是提供从.NET 6到.NET 7的[升级助手](https://dotnet.microsoft.com/platform/upgrade-assistant)，通过代码分析器、自动代码修复等功能，帮助开发者更轻松自信地升级到.NET 7，来获得更好的性能和更多的新特性。  
另一方面是对于传统.NET应用提供更完善的升级指引、文档和工具。

（这个好像意义不大，很多应用之所以不升级不是因为升级容易或者困难，而是只有在不得不升级的时候才会去考虑升级）

### ASP.NET Core

在.NET 7, ASP.NET Core投入在如下几个地方：
* 性能上，[目前ASP.NET Core的性能大约是Java Servlet的3倍，Node.js的10倍](https://www.techempower.com/benchmarks/#section=test&runid=b3d7b2dd-c903-47a0-9e01-7ab3168f03a1&hw=ph&test=plaintext&p=zik0zi-zik0zj-ziimf3-zijxtr-b8jj&a=2)，在.NET 7，ASP.NET Core会继续投入在对性能的提升上
* HTTP/3在.NET 6中是预览功能，在.NET 7将会正式支持并默认启用，并且会带来一些高级TLS特性和更多的性能提升
* 为Minimal APIs提供endpoint过滤器和路由分组的原生支持，并简化其在认证鉴权上的通用配置
* 支持gRPC JSON转码，使开发者可以通过类似RESTful API的方式以JSON编码调用gRPC服务
* 为SignalR支持强类型客户端和在客户端调用时支持返回结果
* 提高Razor编译器的性能、可靠性和工具易用性
* Blazor上会进行AOT、多线程（这个应该是目前比较需要的）、热重载等改进
* 改进MVC中的路由、链接生成、参数绑定等

### Orleans

[Orleans](https://github.com/dotnet/orleans)是.NET中的分布式开发框架，基于[Virtual Actor Model](https://www.microsoft.com/en-us/research/publication/orleans-distributed-virtual-actors-for-programmability-and-scalability)实现，并提供一系列的适用于云原生应用的组件（如状态管理、唤醒器、发布订阅、事件溯源、分布式事务等），Orleans最初启动于微软研究院并在之后很快交给了XBox部门，多年里一直为[微软内部许多项目所使用](https://www.youtube.com/watch?v=KhgYlvGLv9c)。  
在近期，Orleans加入到了.NET团队中，将与.NET的发展方向和发布周期对齐。

Orleans最近刚刚发布了[4.0版本的第一个预览版本](https://github.com/dotnet/orleans/releases)，实现了更易用的Grain ID和Stream ID，以及新的版本兼容的高性能序列化。

Orleans将随着.NET 7发布4.0正式版，在这期间会专注于对易用性、可维护性和性能的提升，以及与ASP.NET Core更好地集成。



按照惯例，.NET 7应该是在今年11月正式发布，在这期间应该还会逐渐公布更多新的特性和改进。


