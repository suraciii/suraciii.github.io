---
title: "使用dotnet-monitor收集k8s中.NET应用的诊断数据"
date: 2022-02-09T00:00:00Z
---

平常在用Visual Studio开发.NET应用时，可以在调试时使用性能诊断工具对应用进行诊断，调查其中诸如内存泄露、线程阻塞等问题。

但是对于线上尤其是运行在容器中的应用来说，收集诊断数据是非常麻烦的，这里介绍使用dotnet-monitor来方便地收集.NET应用诊断数据。

只需要按如下方式对应用的deployment/statefulset进行修改：

```yaml
apiVersion: apps/v1
kind: Deployment
...
spec:
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
	      image: myapp:latest
 	      env:
        - name: DOTNET_DiagnosticPorts
          value: /diag/port
        volumeMounts:
        - mountPath: /diag
          name: diagvol
        - mountPath: /dumps
          name: dumpsvol
      - name: monitor
        image: mcr.microsoft.com/dotnet/monitor
        args: [ "--no-auth" ]
        env:
        - name: DOTNETMONITOR_Urls
          value: http://localhost:52323
        - name: DOTNETMONITOR_DiagnosticPort__ConnectionMode
          value: Listen
        - name: DOTNETMONITOR_DiagnosticPort__EndpointName
          value: /diag/port
        - name: DOTNETMONITOR_Storage__DumpTempFolder
          value: /dumps
        volumeMounts:
        - mountPath: /diag
          name: diagvol
        - mountPath: /dumps
          name: dumpsvol
        resources:
          requests:
            cpu: 50m
            memory: 32Mi
          limits:
            cpu: 250m
            memory: 256Mi
      volumes:
      - name: diagvol
        emptyDir: {}
      - name: dumpsvol
        emptyDir: {}
```

上面进行了三个改动：
1. 添加了名为`monitor`的容器作为sidecar
1. 分别添加了两个名为`diagvol`和`dumpsvol`的空目录volumes，并挂载到被诊断应用和monitor中
2. 为被诊断应用配置`DOTNET_DiagnosticPorts`环境变量

Pod启动后，dotnet-monitor会同被诊断应用的.NET运行时进行IPC通讯，并且dotnet-monitor会将控制命令以API的形式对我们开放。

API列表：
* `/processes` 获取相关进程的详细信息
* `/dump`	获取内存dump
* `/gcdump`	获取GCdump
* `/trace` 获取进程追踪数据
* `/metrics` 以Prometheus格式发布指标数据
* `/livemetrics` 获取进程的实时指标
* `/logs`	获取进程所产生的日志
* `/info` 获取dotnet-monitor的信息
* `/operations`	获取或取消当前进行中的操作

这里以两个主要的诊断场景`trace`和`gcdump`举例演示诊断一个有内存泄露和线程阻塞问题的应用

通过`kubectl port-forward`命令，转发monitor容器的请求到本机，在浏览器中访问`http://localhost:52323/gcdump`，即可捕获并下载被诊断应用的gcdump。

下载完成后，通过perfview打开：

![](/dotnet-monitor-diag-memory-threading/2.png)
![](/dotnet-monitor-diag-memory-threading/3.png)

可以看到内存主要被一个保存了大量`Mail`对象的`ConcurrentBag`所占用。


#### 关于线程阻塞及线程池饥饿问题的诊断

访问`http://localhost:52323/trace?profile=cpu`，即可捕捉应用的跟踪信息并下载，默认会记录30秒的数据，可以通过`durationSeconds`参数更改记录时间。
下载完成后，通过perfview打开

dotnet-monitor内部使用的是和dotnet-trace同样的方式记录追踪信息，而它们都是无法获得线程阻塞时间的数据的，想要获得线程阻塞时间数据，需要使用perfcollect并开启-threadtime选项来收集诊断信息（或者在windows上使用perfview开启/threadTime进行收集）

但是我们依然可以通过dotnet-monitor来得知应用当前线程池的大小、线程队列的长度、线程的调用堆栈等信息，从中也一定程度上可以识别线程池饥饿、定位到导致线程阻塞的代码，如图：
![](/dotnet-monitor-diag-memory-threading/9.png)  
从上图可以看到.NET运行时在不断地创建新的线程

![](/dotnet-monitor-diag-memory-threading/11.png)  
从上图可以看到由于`Starvation`，线程池大小在发生变化（增加）
  
![](/dotnet-monitor-diag-memory-threading/10.png)
在调用堆栈中可以看到有导致线程阻塞的代码

