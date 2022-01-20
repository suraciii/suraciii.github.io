---
title: "愚钝程序员的生存之道 - Part0: 复杂性"
date: 2020-04-22T00:00:00Z
---


工作几年，我发现自己身上有着一些现象：

别人讲给我的东西要讲很多遍我才能理解

学习技术要花很多时间才能掌握

写代码平均每写十几行就会引入一个错误

…

这些现象似乎都指向着一个现实——我是一个愚钝的程序员。

作为一个愚钝的程序员，想要产出平均水平的质量和产量从而生存下去，又不想被无尽的加班和焦头烂额吞噬自己的生活，就不得不掌握一些属于愚钝程序员的生存之道，从而可以不用很辛苦很累也可以交付出高质量的软件。



## 从复杂到复杂性

愚钝程序员在开发活动中总是面临诸多的挑战，这些挑战让愚钝程序员们感到自己愚钝，当我：
- 总是难以搞明白一些代码是如何工作的
- 总是需要花费很长时间来实现一个很小的改进
- 或者总是不清楚自己应该去修改代码的哪些地方来实现这些改进
- 总是难以快速修复一个bug
- 或者总是难以在修复一个bug的同时而不引入另一个bug

当这一系列的状况发生，让我感觉自己无能为力去轻松解决问题，让我感觉自己难以处理，无从下手，让我怀疑自己是否不适合这个行业的时候，我发出了抱怨：

——“这太复杂(Complex/Complicated)了！”




### 区分Complex和Complicated

Complex与Complicated，二者所描述的对象都是是由存在大量互相交互的元素构成的系统，但是二者有着一些细微的不同之处：

对于Complicated系统，它有着确定性(deterministic)，尽管系统中所有的组件都在发生交互，都在影响着系统的状态，但是这种交互是确定的，可测的，可靠的，并且系统被影响后的状态也是有限的、有界的

而对于Complex系统，组件的交互以及对系统的影响是不确定的，系统的可能状态也是无限的、无界的

对于Complex与Complicated，目前我还没有见到一个准确而又权威的定义，有时这两个词汇在不同领域甚至会被用来表达截然相反的两个概念，但是为了方便交流，在这里我们引用了上面这种定义，并且利用一个说法来帮助我们更清晰地识别Complex：

*Complex更偏向于将对象系统作为待解决的问题描述，即当我们使用Complex来描述一个系统时，Complex其实是在描述其投射在我们的大脑中的问题，那个我们正在尝试解决，并且无法轻松地理解处理的问题*




### 复杂性

我们将复杂问题中那些标志其成为复杂问题的要素称作复杂性(Complexity) - 问题系统之所以复杂，正是因为其表现出了复杂性

结合前面的分析，我们可以说：我们解决问题时所面对的复杂性，成为了我们对复杂问题的开发处理难度

也就是说，当我们感觉问题杂乱、庞大，难以理解和处理的时候，我们大概是撞上了问题的复杂性

![1](/how-to-survive-as-an-01x-developer-0/1.png)



## 管理复杂性

 

### 撞上复杂性

面对复杂性，我们通常会有这几种反应：

1. 无视它，我们欺骗自己，假装复杂性并不存在。这种反应体现在我们会对系统做出一些假设，来忽略复杂性，一个经典的例子就是[Fallacies of distributed computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing)，分布式系统中的网络通讯是极其常见的复杂性的来源，但是许多时候我们都会去假设网络是可靠安全稳定的
2. 通过启发探索(heuristic)，即调查(Probe)-感知(Sense)-响应(Respond)，这种方式也可以说是通过本能去应对——我们一步步地试探着前进，运气好的话也许可以积累一些有用经验形成本能来加速这个过程

在大多数情况下，人们面对复杂性时的反应都会是这两种，本质上这两种应对方式都是被动地应对，对于第一种我们可以略过不提，而第二种反应——愚钝的程序员在这条路上无法走得更远

如果我们把一个复杂问题比作一个大泡泡，里面充满了复杂性，那么我们通过启发探索应对复杂性，就是去对问题进行探索和开发，由于学习理解能力、记忆力以及经验的差距，对于那些自身具备优秀的先天条件（学习理解能力、记忆力等）聪慧的程序员(Rockstar developer)，和那些在特定项目或特定领域上浸淫已久获得了丰富经验的地头蛇来说，这不是个很辛苦的过程，但是对于愚钝程序员来说，这里是个不公平的竞技场，一些对于愚钝程序员来说很复杂的问题，对于这些人来说却相对简单



所以面对复杂性，愚钝的程序员要多考虑第三种应对方式




### 抓住复杂性的缰绳


相比于被动地用本能去应对复杂性，作为人类的我们，更应该主动地去认识，识别，分析，从而有效地管理它


#### 复杂性的来源

想要管理复杂性，首先就要知道在软件开发的活动中，我们所面对的复杂性**来源**是哪里

首先是来自现实世界的复杂性——我们开发软件是为了解决现实世界的问题，所以软件的开发必然会引入现实世界的复杂性（一些情况下我们会把它们称做“需求”）

来自现实世界的复杂性是必要的复杂性，大多是作为开发者的我们无法控制的——经济危机可能导致公司的业务方向发生变化，孩子气的用户总是以我们预想不到的方式使用软件，GDPR，英国脱欧……这些都是我们无法改变又不可抗拒的，因为现实世界就是这么运作的

但是作为开发者，除了来自现实世界的复杂性，我们还要面对软件本身的复杂性——随意懒散的建模，混乱的架构设计、千奇百怪的工具和框架、分布式系统的一致性问题甚至迥异的代码风格，都是开发者需要面对的

这两种复杂性并不总是泾渭分明，通常，开发者沟通着现实世界与软件，接收来自现实的复杂性，混合进自己的理解，又通过代码输入到解决方案之中，最终又成为开发者自己需要面对的问题

![2](/how-to-survive-as-an-01x-developer-0/2.png)

现实世界是必要的复杂，但是我们软件不必复杂，软件系统也许甚至经常会是complicated，但是不必complex。**软件是来自开发者的极其自由的创作**，我们将数百万离散的元素聚合到一起，生成新的东西，它没有来自现实世界的诸多干扰和限制，我们无法通过Pull Request来改变现实世界的物理规律，但是我们可以任意去改变我们的软件，因此我们的软件的复杂性在大多数情况下都是可以控制的




### 发现复杂性

我们无法和看不见的敌人战斗

前面提到过当我们觉得问题难以理解，难以处理的时候，说明我们很有可能正在面对问题的复杂性，那么更具体一些，软件的复杂性会以怎样的形式体现呢？

尽管软件系统的复杂性会表现为开发者的开发难度，但是具体地来讲，软件的复杂性会体现为三种形式

#### 1. 改动扩散(Change amplification)

改动扩散是指一个看起来很简单的改动，却需要对软件的多个不同的地方进行代码修改，这种修改被我们称为散弹式修改，它不仅仅意味着劳动量的增加，它所导致的更严重的问题在于，如果一个开发者想要进行这个改动，他就必须要清楚地知道所有需要修改的地方，并且还要清楚地知道这些地方都应该怎么修改，一旦开发者缺乏这些需要的信息和知识，或者是没有充分地理解它们，就极易引入错误

#### 2. 认知负担(Cognitive load)

认知负担是指开发者为了完成一个任务，需要了解多少东西，更高的认知负担意味着开发者们需要花费更多的时间去学习所需要的信息，并且有更高的因为缺乏信息导致的错误风险。

可以看到改动扩散会导致某种程度上的认知负担（当然，认知负担不总是来源于改动扩散，而是一切可能导致开发者们理解困难的东西）

#### 3. 未知的无知(Unknown unknown)

未知的无知（我不确定我有没有翻译好）是指在你想要完成一个任务时，根本不知道应该去修改那些代码，根本不知道你该具备哪些信息，它意味着你有一些需要了解学习的信息，但是你在开发时根本无法发现它们是什么，甚至你根本没有发现你需要了解学习这些，直到之后有bug出现，你才能以回顾的方式发现它们

未知的无知是最糟糕的，它是那些我们无法利用启发探索去到达的地方，而我们却只能以启发探索的方式应对它——因为我们根本不知道它的存在

这是复杂性会体现为的三种形式，我们也可以将这三种形式作为复杂性的信号对待——当它们出现时，我们就要警惕了

而观察这三种形式，可以明显地看到，它们的本质都是体现为开发者信息的匮乏，收集学习必要的信息会拖慢我们的开发，遗漏必要的信息会导致错误风险的增高


### 未知和不确定性

这些信息匮乏的现象是如何产生的呢？原因总体上来自于我们对软件系统的未知和其本身的不确定性

软件系统的不确定性，导致了我们开发软件时所需要了解的信息爆炸，我们需要处理的状况也会增加，而我们对软件系统的未知，在导致我们需要收集额外信息的同时，也容易使我们在开发软件时做出错误的假设——可以说这是一种因无知而产生的傲慢

![3](/how-to-survive-as-an-01x-developer-0/3.png)

所以，管理软件系统复杂性的基本方向，就是通过一系列的手段减少开发时的未知，捕获其中的不确定性，最终**打破迷雾**，让复杂的问题在我们看来变得一目了然（Obvious）


## 关于这篇分享

- 这篇分享里的想法最初来自于对朋友抛出的一个问题“为什么我们要避免循环依赖”的持续发散的思考，结合了一些知识的阅读学习，对一些现象的观察，以及一些从实践中总结的规律，到现在对于这个问题总算是能够给出一个能够说服我自己的答案了
- 当然，观点来自于理解，理解来自于经验，由于每个人的经历不同，很可能每个人的观点和理解也都有所不同，我也无法确定自己的理解是否是足够客观的，普适的，是能够通过正确认识问题从而解决问题的，所以非常希望大家都能分享自己的理解，我也能够通过和大家的交流，有进一步的理解，从而可以不断修正和完善自己的结论
- 这篇是一系列相关分享的第一篇，计划是分享一系列我认为可以提高交付效率和质量，简化开发负担的工具和方法，但是因为这些分享是建立在我对软件开发和其复杂性的理解上的，所以这篇作为第一篇，说一下我的思路，为什么会这么想，后续（如果不鸽的话），我会分享一些更为具体的，可操作的工具和方法

 

#### 管理复杂性需要团队合作

复杂性是由所有的开发者每人每个提交一点一滴的积累起来的——每个人都容易说服自己引入一点点的复杂性不是什么大事，但复杂性持续地在积累中增殖，最终成为软件灾难（[大泥球](https://en.wikipedia.org/wiki/Big_ball_of_mud)）

**软件发展为复杂软件（大泥球）是团队合作的产物，所以也需要团队的力量才能真正解决它**

 

#### 软件复杂性不只是开发者的敌人

尽管软件的高复杂性会加重开发者们的负担，但是它不止对开发者们造成伤害，对于项目本身，软件复杂性也是非常危险的，它会拖慢软件的交付效率，降低软件的交付质量，**失控的软件复杂性是项目过于脆弱的体现**，持续下去会越来越无法承受挑战的冲击
*如果要讨论这个问题，那对象系统就不是软件本身而是整个工程项目了，所以不在此进行深入分析*



##### *参考*：

1. [Antifragile Designing the Systems of the Future - Barry O'Reilly - DDD Europe 2019](https://www.youtube.com/watch?v=pMfzxmCzThI)
2. Cynefin framework https://en.wikipedia.org/wiki/Cynefin_framework
3. **[The Fundamental Truth behind Successful Development Practices: Software is Synthetic](https://www.infoq.com/articles/software-is-synthetic)** 
   \- 非常好的一篇文章，讲清楚了“当我们在开发软件时，我们究竟在做什么”
4. **[A Philosophy of Software Design](https://www.goodreads.com/en/book/show/39996759-a-philosophy-of-software-design)**
   \- 这个分享中有很大一部分内容都是参考的这本书，我还没看完，但是就现在的体会而言，非常值得一看