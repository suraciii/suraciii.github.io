---
title: 为Kubernetes集群添加用户
date: 2018-08-29T00:00:00Z
---

## Kubernetes中的用户

K8S中有两种用户(User)——服务账号(ServiceAccount)和普通意义上的用户(User)  
ServiceAccount是由K8S管理的，而User通常是在外部管理，K8S不存储用户列表——也就是说，添加/编辑/删除用户都是在外部进行，无需与K8S API交互，虽然K8S并不管理用户，但是在K8S接收API请求时，是可以认知到发出请求的用户的，实际上，所有对K8S的API请求都需要绑定身份信息(User或者ServiceAccount)，这意味着，可以为User配置K8S集群中的请求权限

### 有什么区别？

最主要的区别上面已经说过了，即ServiceAccount是K8S内部资源，而User是独立于K8S之外的。从它们的本质可以看出：  

* User通常是人来使用，而ServiceAccount是某个服务/资源/程序使用的  

* User独立在K8S之外，也就是说User是可以作用于全局的，在任何命名空间都可被认知，并且需要在全局唯一  
  而ServiceAccount作为K8S内部的某种资源，是存在于某个命名空间之中的，在不同命名空间中的同名ServiceAccount被认为是不同的资源

* K8S不会管理User，所以User的创建/编辑/注销等，需要依赖外部的管理机制，K8S所能认知的只有一个用户名
  ServiceAccount是由K8S管理的，创建等操作，都通过K8S完成

这里说的添加用户指的是普通意义上的用户，即存在于集群外的用户，为k8s的使用者。  
实际上叫做添加用户也不准确，用户早已存在，这里所做的只是使K8S能够识别此用户，并且控制此用户在集群内的权限

## 用户验证

尽管K8S认知用户靠的只是用户的名字，但是只需要一个名字就能请求K8S的API显然是不合理的，所以依然需要验证此用户的身份
在K8S中，有以下几种验证方式：  

* X509客户端证书  
客户端证书验证通过为API Server指定`--client-ca-file=xxx`选项启用，API Server通过此ca文件来验证API请求携带的客户端证书的有效性，一旦验证成功，API Server就会将客户端证书Subject里的CN属性作为此次请求的用户名

* 静态token文件  
通过指定`--token-auth-file=SOMEFILE `选项来启用bearer token验证方式，引用的文件是一个包含了 token,用户名,用户ID 的csv文件
请求时，带上`Authorization: Bearer 31ada4fd-adec-460c-809a-9e56ceb75269`头信息即可通过bearer token验证

* 静态密码文件  
通过指定`--basic-auth-file=SOMEFILE`选项启用密码验证，类似的，引用的文件时一个包含 密码,用户名,用户ID 的csv文件
请求时需要将`Authorization`头设置为`Basic BASE64ENCODED(USER:PASSWORD)`

这里只介绍客户端验证

## 为用户生成证书

假设我们操作的用户名为tom

1. 首先需要为此用户创建一个私钥  
`openssl genrsa -out tom.key 2048`

2. 接着用此私钥创建一个csr(证书签名请求)文件，其中我们需要在subject里带上用户信息(CN为用户名，O为用户组)  
`openssl req -new -key tom.key -out tom.csr -subj "/CN=tom/O=MGM"`  
其中/O参数可以出现多次，即可以有多个用户组

3. 找到K8S集群(API Server)的CA证书文件，其位置取决于安装集群的方式，通常会在`/etc/kubernetes/pki/`路径下，会有两个文件，一个是CA证书(ca.crt)，一个是CA私钥(ca.key)  

4. 通过集群的CA证书和之前创建的csr文件，来为用户颁发证书  
`openssl x509 -req -in tom.csr -CA path/to/ca.crt -CAkey path/to/ca.key -CAcreateserial -out tom.crt -days 365`  
-CA和-CAkey参数需要指定集群CA证书所在位置，-days参数指定此证书的过期时间，这里为365天

5. 最后将证书(tom.crt)和私钥(tom.key)保存起来，这两个文件将被用来验证API请求

## 为用户添加基于角色的访问控制(RBAC)

### 角色(Role)

在RBAC中，角色有两种——普通角色(Role)和集群角色(ClusterRole)，ClusterRole是特殊的Role，相对于Role来说：  

* Role属于某个命名空间，而ClusterRole属于整个集群，其中包括所有的命名空间  

* ClusterRole能够授予集群范围的权限，比如node资源的管理，比如非资源类型的接口请求(如"/healthz")，比如可以请求全命名空间的资源(通过指定 --all-namespaces)


### 为用户添加角色

#### 首先创造一个角色

``` yaml
kind: Role
apiVersion: rbac.authorization.k8s.io/v1beta1
metadata:
  namespace: a-1
  name: admin
rules:
- apiGroups: [""]
  resources: ["*"]
  verbs: ["*"]
```

这是在a-1命名空间内创建了一个admin管理员角色，这里只是用admin角色举例，实际上如果只是为了授予用户某命名空间管理员的权限的话，是不需要新建一个角色的，K8S已经内置了一个名为admin的ClusterRole

#### 将角色和用户绑定

``` yaml
kind: RoleBinding
apiVersion: rbac.authorization.k8s.io/v1beta1
metadata:
  name: admin-binding
  namespace: a-1
subjects:
- kind: User
  name: tom
  apiGroup: ""
roleRef:
  kind: Role
  name: admin
  apiGroup: ""
```

如yaml中所示，RoleBinding资源创建了一个 Role-User 之间的关系，`roleRef`节点指定此RoleBinding所引用的角色，`subjects`节点指定了此RoleBinding的受体，可以是User，也可以是前面说过的ServiceAccount，在这里只包含了名为 tom 的用户

#### 添加命名空间管理员的另一种方式

前面说过，K8S内置了一个名为admin的ClusterRole，所以实际上我们无需创建一个admin Role，直接对集群默认的admin ClusterRole添加RoleBinding就可以了

``` yaml
kind: RoleBinding
apiVersion: rbac.authorization.k8s.io/v1beta1
metadata:
  name: admin-binding
  namespace: a-1
subjects:
- kind: User
  name: tom
  apiGroup: ""
roleRef:
  kind: ClusterRole
  name: admin
  apiGroup: ""
```

这里虽然引用的是作为ClusterRole的admin角色，但是其权限被限制在RoleBinding admin-binding所处的命名空间，即a-1内
如果想要添加全命名空间或者说全集群的管理员，可以使用cluster-admin角色


到此为止，我们已经：
* 为tom用户提供了基于X509证书的验证
* 为a-1命名空间创造了一个admin角色
* 为用户tom和角色admin创建了绑定关系

## 为kubectl配置用户

tom已经是管理员了，现在我们想要通过kubectl以tom的身份来操作集群，需要将tom的认证信息添加进kubectl的配置，即~/.kube/config中

这里假设config中已经配置好了k8s集群

1. 通过命令`kubectl config set-credentials tom --client-certificate=path/to/tom.crt  --client-key=path/to/tom.key`将用户tom的验证信息添加进kubectl的配置  
此命令会在配置中添加一个名为tom的用户

2. `kubectl config set-context tom@aliyun --cluster=aliyun --namespace=a-1 --user=tom`  
此命令添加了一个context配置——设定使用aliyun集群，默认使用a-1命名空间，使用用户tom进行验证

3. 在命令中带上 `kubectl --context=tom@aliyun ...` 参数即可指定kubectl使用之前添加的名为tom@aliyun的context操作集群  
    也可以通过命令 `kubectl config use-context tom@aliyun` 来设置当前使用的context


#### Tips: 将认证信息嵌入kubectl的配置中

通过`kubectl config set-credentials`命令添加的用户，其默认使用的是引用证书文件路径的方式，表现在~/.kube/config中，就是：

```
users:
- name: tom
  user:
    client-certificate: path/to/tom.crt
    client-key: path/to/tom.key
```

如果觉得这样总是带着两个证书文件不方便的话，可以将证书内容直接放到config文件里

1. 将tom.crt/tom.key的内容用BASE64编码  
`cat tom.crt | base64 --wrap=0`  
`cat tom.key | base64 --wrap=0`  

2. 将获取的编码后的文本复制进config文件中

```
users:
- name: ich
  user:
    client-certificate-data: ...
    client-key-data: ...
```

这样就不再需要证书和私钥文件了，当然这两个文件还是保存起来比较好


*参考资料：*  
*[Authenticating - Kubernetes Docs](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)*  
*[Configure RBAC in your Kubernetes Cluster](https://docs.bitnami.com/kubernetes/how-to/configure-rbac-in-your-kubernetes-cluster/)*  
*[Using RBAC Authorization - Kubernetes Docs](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)*  
*[Kubectl Reference Docs#config](https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands#config)*  
*[Kubernetes auth: X509 client certificates](https://brancz.com/2017/10/16/kubernetes-auth-x509-client-certificates/)*  