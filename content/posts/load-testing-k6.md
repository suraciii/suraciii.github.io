---
title: "使用k6进行负载测试"
date: 2023-08-24T00:00:00Z
draft: false
---

## k6

k6是一款来自Grafana的开源的负载测试工具。

官方说法中，K6的特点是：
* 提供简单易用的CLI工具，具有开发人员友好的API。
* 使用 JavaScript ES2015/ES6 编写脚本 - 支持本地和远程模块
* 检查(Checks)和阈值(Thresholds) - 用于面向目标、自动化友好的负载测试

### 和其它负载工具测试对比

### JMeter
* k6没有界面化的UI，需要编写基于JavaScript的测试脚本，以及通过命令行来执行测试，这意味着k6的使用者需要具备一些基本的编码能力
* 不像JMeter，k6可以轻松地集成到自动化的DevOps流水线中
* k6只支持HTTP相关的负载测试(HTTP1/2, gRPC, WebSockets等)
* k6的性能强劲并且效率高，即使在配置一般的笔记本电脑上也能轻松跑出上万级别的qps

### Gatling
* 学习成本没有Gatling高（主要是因为Scala的学习成本比较高）
* 同样，相对于Gatling，k6的性能和效率非常出色
* Gatling只在高级版本支持分布式负载

### Vegeta
* k6的性能和效率略微逊色于Vegeta
* Vegeta不支持脚本化测试，使用起来比较不方便

### 总结

对于开发者或者具备一些JavaScript编码能力的测试人员来说，k6使用起来非常方便，其性能高，成本低，可以方便地集成进自动化流水线，支持分布式负载

## 一般使用姿势

k6使用起来非常简单，只需要3步

### 1. 安装

MacOS下可以通过`brew install k6`命令安装

Windows下，如果安装了`Chocolatey`或者`winget`等包管理工具，可以通过工具命令安装

或者，访问github.com/grafana/k6/releases，下载对应的安装包或可执行文件

### 2. 编写脚本

```javascript
import { check } from 'k6';
import http from 'k6/http';
export default function () {
    const url = `${baseUrl}/items`
    const req_body = {
        "foo": "bar",
    };
    const params = {
        headers: {
            'Content-Type': 'application/json'
        }
    };
    const res = http.post(url, JSON.stringify(req_body), params);
    check(res, {
        'status is 200': () => res.status === 200,
    });
};
```

### 3. 执行

```shell
k6 run --vus 400 --duration 3m mytest.js
```
(启动400个vu，持续执行3分钟)

等待执行结果：
```log
✓ status is 200

█ setup

checks.........................: 100.00% ✓ 495418      ✗ 0
data_received..................: 116 MB  642 kB/s
data_sent......................: 371 MB  2.1 MB/s
http_req_blocked...............: avg=38.93µs  min=924ns    med=2.45µs   max=80.93ms  p(90)=3.56µs   p(95)=4.48µs
http_req_connecting............: avg=5.88µs   min=0s       med=0s       max=30.2ms   p(90)=0s       p(95)=0s
http_req_duration..............: avg=145.1ms  min=10.55ms  med=109.6ms  max=2.99s    p(90)=296.31ms p(95)=372.08ms
  { expected_response:true }...: avg=145.1ms  min=10.55ms  med=109.6ms  max=2.99s    p(90)=296.31ms p(95)=372.08ms
http_req_failed................: 0.00%   ✓ 0           ✗ 495418
http_req_receiving.............: avg=1.28ms   min=12.33µs  med=307.76µs max=120.82ms p(90)=3.44ms   p(95)=5.25ms
http_req_sending...............: avg=31.82µs  min=7.4µs    med=16.63µs  max=135.44ms p(90)=28.31µs  p(95)=46.41µs
http_req_tls_handshaking.......: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
http_req_waiting...............: avg=143.79ms min=10.49ms  med=108.24ms max=2.98s    p(90)=294.81ms p(95)=370.19ms
http_reqs......................: 495418  2749.134151/s
iteration_duration.............: avg=145.37ms min=300.04µs med=109.85ms max=2.99s    p(90)=296.56ms p(95)=372.5ms
iterations.....................: 495418  2749.134151/s
vus............................: 400     min=0         max=400
vus_max........................: 400     min=400       max=400
```

## 在Kubernetes中进行分布式负载测试

分布式负载测试需要在Kubernetes中安装`k6-operator`：

```shell
curl https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml | kubectl apply -f -
```

安装完成后，需要将测试脚本写入ConfigMap中：
```shell
kubectl create configmap mytest --from-file "mytest.js"
script.js
```

之后，通过在Kubernetes中创建一个类型为`K6`的资源，来执行测试：
```yaml
apiVersion: k6.io/v1alpha1
kind: K6
metadata:
  name: mytest
spec:
  runner:
    image: registry.cn-hangzhou.aliyuncs.com/surac/grafana-operator:latest-runner
	# 这个镜像以及下面的镜像是我自己打包的，如果需要用到一些额外的k6扩展，则需要自己打包镜像
  starter:
    image: registry.cn-hangzhou.aliyuncs.com/surac/grafana-operator:latest-starter
  parallelism: 4 #并行实例数，测试任务会分摊到各个实例执行
  script:
    configMap:
      name: mytest.js
      file: mytest.js
```
```shell
kubectl apply -f mytest.yaml
```

k6-operator发现这个资源被创建后，就会创建1个启动`Job`和4个执行`Job`，来执行测试任务，可以通过`kubectl get jobs`来观察

```log
NAME             COMPLETIONS   DURATION   AGE
mytest-1         1/1           115s       440d
mytest-2         1/1           114s       440d
mytest-3         1/1           79s        440d
mytest-starter   1/1           2s         440d
```

## 最后

k6还有许多功能，比如：
* 阈值(Thresholds)，比如设定“请求的错误率>1%”或者“p99延迟>500ms”时提前结束测试并视为失败，很适合针对服务的SLO来进行测试
* 支持将测试指标写到Prometheus，这样就可以在做负载测试时，将QPS、延迟等指标结合服务的CPU、内存、线程等指标进行观察，并且浏览和统计数据也很方便

