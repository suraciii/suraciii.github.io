---
title: 使用Pulumi在Kubernetes中部署应用
date: 2022-01-28T00:00:00Z
---

Pulumi是一个现代`基础设施即代码(infrastructure as code)`平台，通过它，我们可以使用我们熟悉的编程语言和工具来构建、部署和管理云及云原生基础设施。 

来看一个最简单的例子，准备如下typescript代码：
```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const group = new aws.ec2.SecurityGroup("web-sg", {
    description: "Enable HTTP access",
    ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] }],
});

const server = new aws.ec2.Instance("web-server", {
    ami: "ami-6869aa05",
    instanceType: "t2.micro",
    vpcSecurityGroupIds: [ group.name ], // reference the security group resource above
});
```

运行`pulumi up`命令，即可在AWS中创建一个ec2实例并配置其安全组。

如果我们需要修改其安全组配置，加上443端口的入口，那么只需要更改代码:
```typescript
const group = new aws.ec2.SecurityGroup("web-sg", {
    description: "Enable HTTP access",
    ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
		{ protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] }],
});
```
再次运行`pulumi up`命令，即可对相关安全组进行更新。

这里的例子是使用tyescript代码管理AWS中的资源，此外，Pulumi还支持python、C#、go等编程语言，以及Azure、GCP、阿里云、Kubernetes等平台。

Pulumi作为一个基础设施即代码工具，首先其当然也具备基础设施即代码这种实践的优点，如：
* 基础设施的定义作为代码可以被版本控制
* 因此可以被review和revert
* 实践基础设施即代码可以帮助团队以可靠、可重复、可控制的方式部署系统资源
* 也可以为自动化部署和减少人工出错提供帮助
* 此外还有：提高不同环境中的基础设施的一致性，降低基础设施及其部署过程的复杂性等

具体关于基础设施即代码这里不再赘述，重点是，Pulumi相对于其它基础设施即代码的平台和工具，如Terraform、ARM、Ksonnet等，具备如何的优势呢？

### Pulumi的优势

首先Pulumi最大的优点是其学习成本低，学习曲线平缓。  
能够采用基础设施即代码实践的团队，基本上要么就是实践的DevOps，授权开发者来管理产品基础设施，要么团队运维人员也会掌握编程技能，而Pulumi使用go、typescript等常用的编程语言作为其管理基础设施的代码，这些语言对于上面说的使用者来说算得上是轻车熟路了，只需要使用自己常用的编程语言，不需要面对任何自创的五花八门奇奇怪怪的语法和模板。

另外，如typescript、go、C#这些编程语言，功能上都十分完备，也有着非常完善的IDE支持，比如我们可以在代码中使用栈和队列等数据结构，可以进行抽象、封装，定义类和函数等，甚至我们可以对这些基础设施代码进行调试和单元测试，这在其它依靠Json/Yaml或者模板为主的工具上基本是无法做到的。

### 使用Pulumi在Kubernetes中部署应用

这里简单演示如何使用Pulumi在Kubernetes中部署应用。

首先我们需要安装Pulumi CLI，通过macOS上的Homebrew和Windows上的Chocolatey等工具都可以直接安装Pulumi CLI，Linux下可以通过`curl -fsSL https://get.pulumi.com | sh`命令安装。

安装完成后，我们需要配置Pulumi存储资源状态的方式及路径，可以选择`pulumi login https://api.pulumi.com`使用Pulumi平台存储状态，也可以选择`pulumi login file://.`将状态保存到本地`.pulumi`（相对或绝对）路径下，也支持通过Azure KeyVault等密文管理产品来存储

然后选择一个合适的路径，运行：
```shell
$ pulumi new kubernetes-typescript
```
（这里以使用typescript为例，也可以使用其它编程语言。）

跟着指引一步步填写相关信息，如：
```shell
project name: demo-meetingsvc
project description: A meeting service
stack name: dev # stack可以简单理解为环境
```

执行完成后，Pulumi会在目录中生成项目以及初始实例代码，可以打开`index.ts`查看：
```typescript
import * as k8s from "@pulumi/kubernetes";

const appLabels = { app: "nginx" };
const deployment = new k8s.apps.v1.Deployment("nginx", {
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
            metadata: { labels: appLabels },
            spec: { containers: [{ name: "nginx", image: "nginx" }] }
        }
    }
});
export const name = deployment.metadata.name;
```

上面代码的作用是创建一个nginx部署，我们可以删掉这段代码，改成我们想要的。

首先，新建一个命名空间：
```typescript
import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

const namespace = new kubernetes.core.v1.Namespace("my-namespace");
```

运行`pulumi up`，会首先进行变更预览：
```shell
Previewing update (dev)                                                                   
                                                                                          
     Type                             Name                 Plan                           
 +   pulumi:pulumi:Stack              demo-meetingsvc-dev  create                         
 +   └─ kubernetes:core/v1:Namespace  my-namespace         create                         
                                                                                          
Resources:                                                                                
    + 2 to create                                                                         
                                                                                          
Do you want to perform this update?  [Use arrows to move, enter to select, type to filter]
  yes                                                                                     
> no                                                                                      
  details                                                                                 
```

选择`details`可以查看即将进行的改动详情：
```shell
Do you want to perform this update? details
+ pulumi:pulumi:Stack: (create)
    [urn=urn:pulumi:dev::demo-meetingsvc::pulumi:pulumi:Stack::demo-meetingsvc-dev]
    + kubernetes:core/v1:Namespace: (create)
        [urn=urn:pulumi:dev::demo-meetingsvc::kubernetes:core/v1:Namespace::my-namespace]
        [provider=urn:pulumi:dev::demo-meetingsvc::pulumi:providers:kubernetes::default_3_14_1::04da6b54-80e4-46f7-96ec-b56ff0331ba9]
        apiVersion: "v1"
        kind      : "Namespace"
        metadata  : {
            annotations: {
                pulumi.com/autonamed: "true"
            }
            labels     : {
                app.kubernetes.io/managed-by: "pulumi"
            }
            name       : "my-namespace-20a6saph"
        }
```

选择`yes`便会真正进行相应的改动:
```shell
Do you want to perform this update? yes
Updating (dev)

     Type                             Name                 Status
 +   pulumi:pulumi:Stack              demo-meetingsvc-dev  created
 +   └─ kubernetes:core/v1:Namespace  my-namespace         created

Resources:
    + 2 created

Duration: 4s
```

使用kubectl查看，可以看到创建出了一个新的namespace：
```shell
$ kubectl get ns
NAME           STATUS   AGE
my-namespace-ifywo1p0   Active   1m
```

可以看到新创建的namespace带了一个后缀，这是Pulumi为了维护`不可变基础设施`而故意设计的一种行为，它的好处这里先不做介绍，如果不想要这个后缀，可以显示指定资源名字而非自动生成：
```typescript
const namespace = new k8s.core.v1.Namespace("my-namespace", {
  metadata:{
    name: "my-namespace",
  }
});
```

命名空间创建好后，接着添加deployment和service：
```typescript
const appName = "meetingsvc";
const image = `${imageRepo}/${imageName}:${imageTag}`;

const selector = {
  "app.kubernetes.io/app": appName,
}
const labels = {
  "app.kubernetes.io/part-of": "demo",
  ...selector
};

const deployment = new k8s.apps.v1.Deployment(appName, {
  metadata: {
    namespace: namespace.metadata.name,
    labels
  },
  spec: {
    selector: { matchLabels: selector },
    template: {
      metadata: { labels },
      spec: {
        containers: [{
          name: appName,
          image,
          ports: [{
            containerPort: 80,
            name: "http",
          }],
        }]
      }
    }
  }
});

const svc = new k8s.core.v1.Service(appName, {
  metadata: {
    namespace: namespace.metadata.name,
    labels
  },
  spec: {
    ports: [{
      port: 80,
      targetPort: "http",
    }],
    selector,
  },
}, { dependsOn: deployment });

```

运行`pulumi up`即可预览并进行相关变更。
如果应用需要ingress，也可以通过相同的方式创建。


## 最后

虽说Pulumi支持多种编程语言及运行时(node.js上的javascript、typescript，.net core上的C#、vb、F#，以及go和python），但是就个人经验来说，用起来最得心应手的还是typescript，主要是因为typescript有着十分完备、强大的类型系统，也一定程度上继承了javascript的灵活性，能用上一些很有意思的小花招，后面可以慢慢介绍。

这篇就先写到这，后面准备写一下怎么用Pulumi做自动化部署，用Pulumi做更复杂的部署，组件的封装和打包等。

如果有任何疑惑或者想法，欢迎找我交流~
