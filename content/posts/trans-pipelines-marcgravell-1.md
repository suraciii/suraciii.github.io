---
title: Pipelines - .NET中的新IO API指引(一)
date: 2018-07-01T00:00:00Z
---

原文：[Pipelines - a guided tour of the new IO API in .NET, part 1](https://blog.marcgravell.com/2018/07/pipe-dreams-part-1.html)

作者：marcgravell

大约两年前，我发表了一篇[关于.NET中即将到来的体验性新IO API](https://blog.marcgravell.com/2016/09/channelling-my-inner-geek.html)的博文——在那时它被叫做"Channels"；在2018年的五月末，它终于在[System.IO.Pipelines](https://www.nuget.org/packages/System.IO.Pipelines/)命名空间中落地，我对这系列API巨感兴趣，而在几个星期前，我被分配去用"Pipelines"改造`StackExchange.Redis`以[作为我们2.0更新的一部分](https://github.com/StackExchange/StackExchange.Redis/issues/871)

我希望在这个系列可以讨论：

* "Pipelines"是什么
* 如何在代码方面使用它们
* 什么时候你也许会想要使用它们

为了表达地更具体，在介绍完"Pipelines"后，我打算大篇幅地讲解StackExchange.Redis中的相关转换，并且作为讨论在不同场景下它分别解决了哪些问题的一部分。简略地说：在几乎所有的情况下，答案可以概括为：

*它非常适合那些在IO代码中复杂却普遍的痛点；使我们可以替换掉那些丑陋的封装(kludge)、变通(workaround)或妥协(compromise)——用一个在框架中设计优雅的专门的解决方案。*

我敢肯定，我下面所覆盖的那些痛点，对于那些工作在"数据协议(data protocol)"层面的人来说，一定非常熟悉。

### Pipelines替代/完善了什么？

首先：现有框架中最接近Pipelines的是什么？很简单，Stream ,Stream API对于那些做过序列化或是数据协议工作的人来说非常熟悉，但是，Stream其实是一个非常模糊的API——它在不同的场景表现地非常不同：

* 一些Stream是只读的，一些是只写的，一些是读/写的
* 一样的实体类型有时候是只读的，而有时是只写的（比如`DeflateStream`)
* 当一个Stream是读/写时，它像是一个磁带，读写操作全作用于同样的下层数据（`FileStream`,`MemoryStream`) ，而有时它像是两个不同的Stream，读写作用于本质上完全不同的两个Stream(`NetworkStream`, `SslStream`)——即duplex stream
* 在许多deplex(双工)场景下，很难甚至根本不可能表达“之后没有新数据会到来，但是你应该继续读取数据直到结束“——只有`Close()`，而它会将deplex的两部分同时关闭
* 有时Stream会是可探查的(Seekable)并且支持`Position`和`Length`的概念，不过大多数不会
* 由于API随着时间的推移，通常会有多种方法来表达同一种操作——比如，我们可以用Read(同步)，BeginRead/EndRead(IAsyncResult模式的异步)，或者ReadAsync(async/await模式的异步)；在多数情况下，调用代码无从得知到底哪种方法才是推荐的/最佳的API
* 如果你使用任何一种异步API，通常很难清楚分辨它的线程模型是什么；它实质上是同步的吗？如果不是，是哪个线程会回调？它用了同步上下文吗？线程池？IO complection-port线程？
* 并且在最近，有了允许使用`Span<byte>`/`Memory<byte>`替换`byte[]`的API——再一次的，调用者无法知道哪一种才是”更好的“API
* 这种API本质上*鼓励*复制数据；需要缓冲区？那是将数据复制到了另一块内存中，需要一个尚未处理的数据仓库？同样是复制了数据到另一块内存中

所以即使在我们开始讨论现实世界中的Stream例子和使用它们所导致的问题之前，很明显Stream API本身已经有了*很多*问题，所以首先显而易见的是，Pipelines解决了这些混乱

### 什么是Pipelines

说起"Pipelines"，我指的是一组4个关键API，它们实现对一个二进制流解耦、重叠(overlapped)的读写访问，包括缓冲区管理(池化，回收)，线程感知，丰富的积压控制，和通过背压达到的溢出保护——所有这些都基于一个围绕非连续内存设计的 API，That's a *heck* of a word salad——但是不要担心，我会讨论每一个元素来解释我的意思。

### 从简单的开始：对一个单独的管道进行写入和读取

让我们先准备一个对等的Stream，然后写入一些简单的东西，然后再读取回来——坚持只使用Stream API。我们将只使用ASCII文本以便不用担心有任何复杂编码的状况，并且我们的读写代码不对下层数据流做任何假设。我们只是写入数据，并且读取到流的末尾从而消费它。

我们将先用Stream来做这些——熟悉的领域，然后我们用Pipelines重新实现它，来看其中的相似和不同之处，在之后，我们将研究在其内部究竟发生了什么，然后我们就能明白为什么它会吸引我们

也许你会说"啊，我想起来了`TextReader`/`TextWriter`"，我故意不去使用它们——因为我在这里是在尝试谈论Stream API，这样我们的例子可以扩展到广泛的数据协议和场景

``` csharp
using (MemoryStream ms = new MemoryStream())
{
    // write something
    WriteSomeData(ms);
    // rewind - MemoryStream works like a tape
    ms.Position = 0;
    // consume it
    ReadSomeData(ms);
}
```

现在，要写入Stream，调用方需要获取并填充一个缓冲区然后将其传递给Stream，此时我们为了简化它，使用同步的API，并且简单地分配一个byte数组

``` csharp
void WriteSomeData(Stream stream)
{
    byte[] bytes = Encoding.ASCII.GetBytes("hello, world!");
    stream.Write(bytes, 0, bytes.Length);
    stream.Flush();
}
```

注意：如果要提高效率地话，在上面的代码中有很多可以做的，但是这不是重点。所以如果你熟悉这类代码并且看着膈应，别慌，之后我们会让它变得更丑陋——呃，我是说更有效率

读逻辑的代码会比写逻辑更复杂，因为读代码无法假定一次单独的调用就可以获得所有的数据，一个对Stream的读操作可能会什么也不返回(表明已经读到数据末尾)，也可能填满我们的缓冲区，或者只是返回了一个字节即使我们准备了一个巨大的缓冲区。所以Stream的读代码大多数会是一个循环：

``` csharp
void ReadSomeData(Stream stream)
{
    int bytesRead;
    // note that the caller usually can't know much about
    // the size; .Length is not usually usable
    byte[] buffer = new byte[256];
    do
    {
        bytesRead = stream.Read(buffer, 0, buffer.Length);
        if (bytesRead > 0)
        {   // note this only works for single-byte encodings
            string s = Encoding.ASCII.GetString(
                buffer, 0, bytesRead);
            Console.Write(s);
        }
    } while (bytesRead > 0);
}
```

现在我们将它翻译成pipelines，一个Pipe可以大略地比作一个`MemoryStream`，除了不能多次倒带(rewind)，数据是一个简单的先进先出队列，我们有一个`writer`API可以在一端推入数据，而一个`reader`API可以在另一端将数据取出，Pipe就是坐在二这之中的一个缓冲区。让我们重现之前的场景，但是用一个Pipe替换掉`MemoryStream`（同样，实践中我们通常不会这么做，但是易于举例）：

``` csharp
Pipe pipe = new Pipe();
// write something
await WriteSomeDataAsync(pipe.Writer);
// signal that there won't be anything else written
pipe.Writer.Complete();
// consume it
await ReadSomeDataAsync(pipe.Reader);
```

首先我们用默认选项创造一个pipe，然后我们写入它。注意在Pipe中的IO操作通常都是异步的，所以我们需要await我们的两个帮助方法，同样注意，我们并没有将这个Pipe传入它们——和Stream不同，pipelines 对于读和写有着不同的API层面，所以我们将一个`PipeWriter` 传入帮助方法用来写入数据，然后传入一个`PipeReader`来读取数据，写入数据后，我们在`PipeWriter`上调用`Complete()`。我们不需要在`MemoryStream`中做这个因为当它到达缓冲数据的末尾时会自动[EOFs](https://en.wikipedia.org/wiki/End-of-file)——但是在一些其它的Stream实现中——尤其是单向流——我们也许需要在写入数据后调用`Close`

好了，那么我们的`WriteSomeDataAsync` 是什么呢？注意，我在下面的代码中故意多写了注释：

``` csharp
async ValueTask WriteSomeDataAsync(PipeWriter writer)
{
    // use an oversized size guess
    Memory<byte> workspace = writer.GetMemory(20);
    // write the data to the workspace
    int bytes = Encoding.ASCII.GetBytes(
        "hello, world!", workspace.Span);
    // tell the pipe how much of the workspace
    // we actually want to commit
    writer.Advance(bytes);
    // this is **not** the same as Stream.Flush!
    await writer.FlushAsync();
}
```

首先要注意的是，在处理pipelines时：不是你控制缓冲区，而是Pipe，回想我们的Stream代码，读和写代码都创建了本地byte[]，但是在这里我们没有，相反，我们通过`GetMemory` (或者它的孪生方法`GetSpan`)向Pipe请求了一个缓冲区(`workspace`)，就先你从名字中想到的那样，这给了我们一个`Memory<byte>`或是一个`Span<byte>` ——其容量为最少20字节

获取这个缓冲区后，将我们的字符串编码进去，这意味着我们是直接写入Pipe的内存，并且记录下*实际上*我们使用了多少字节，然后我们通过`Advance`告诉Pipe，我们不受之前请求的20字节的限制——我们可以写入0，20，甚至50字节，最后一个看起来也许会令人意外，但是这实际上是被鼓励的！之前的重点是“至少”——writer可以时间上给我们一个比我们请求的大的很多的缓冲区。当处理较大的数据时，得陇望蜀是很常见的：请求一个我们能有效利用的最小空间，但是之后在检查提供给我们的memory/span的体积后，再决定最终实际写入多少。

对`Advance`的调用很重要，它意味着一次写操作的终结，使得Pipe中的数据可用从而被reader消费。对`FlushAsync` 的调用同样重要，但是有微妙的区别，但是在我们可以充分地阐明这区别是什么前，我们需要先看一看reader。这是我们的`ReadSomeDataAsync` 方法：

``` csharp
async ValueTask ReadSomeDataAsync(PipeReader reader)
{
    while (true)
    {
        // await some data being available
        ReadResult read = await reader.ReadAsync();
        ReadOnlySequence<byte> buffer = read.Buffer;
        // check whether we've reached the end
        // and processed everything
        if (buffer.IsEmpty && read.IsCompleted)
            break; // exit loop

        // process what we received
        foreach (Memory<byte> segment in buffer)
        {
            string s = Encoding.ASCII.GetString(
                segment.Span);
            Console.Write(s);
        }
        // tell the pipe that we used everything
        reader.AdvanceTo(buffer.End);
    }
}
```

就像Stream例子一样，我们有一个循环持续到我们读取到数据的末尾，在Stream中，这种情况通过`Read`方法返回一个非正结果时判定，但是在pipeline中有两种检查方式：

* `read.IsCompleted`告诉我们那个写pipe是否被通知完成，并且不会再有数据被写入(pipe.Writer.Complete();之前代码中的这句)
* `buffer.IsEmpty`告诉我们*在这次操作*中没有剩余的数据需要处理

如果pipe中不再有数据并且writer被通知complete，那么将永远不会有东西存在于这个pipe中，那我们就可以退出了

如果我们有数据存在，我们可以查看缓冲区，所以首先——我们要谈谈缓冲；在代码中那是个新类型`ReadOnlySequence<byte>`——这个概念结合了几个角色：

* 描述不连续内存，特别是一个由0个，1个或多个`ReadOnlyMemory<byte>`块组成的序列
* 描述在这个数据流中的一个逻辑位置(`SequencePosition`)—— in particular via `buffer.Start` and `buffer.End`

`非连续`在此非常重要，我们很快将看到这些数据实际上的去向，但在读方面：我们需要准备好处理可以跨多个部分传播的数据。在这里，我们通过简单的遍历缓冲区，轮流解码每一段数据来达到目的。请注意, 即使 API 被设计为可以描述多个非连续缓冲区, 但通常情况下, 接收到的数据在单个缓冲区中是连续的。在这种情况下, 通常可以为单个缓冲区编写优化的实现。你可以通过检查`buffer.IsSingleSegment`和访问`buffer.First`来做到。

最终，我们调用`AdvanceTo`，告诉Pipe我们实际上使用了多少数据。

### 关键点：你无需取出你提供的所有数据

对比流：当你在Stream上调用Read时，它会将所有数据放到你给它的缓冲区中，在大多数现实场景中，并不是总是能及时消费掉所有的数据——maybe it only makes sense to consider "commands" as "entire text lines",, and you haven't yet seen a `cr`/`lf` in the data. 对于Stream来说，这点很坑——一旦数据给了你，就是你的问题了，如果你现在用不上它，那你就要在某处储备这段数据，但是对于Pipelines，你可以告诉它你消费过了。在我们的例子中，我们通过传递`buffer.End`到`AdvanceTo`来告诉它我们消费掉了之前提供的所有数据。这意味着我们将永远不会再见到这段数据，就像用Stream一样，但是，我们也可以传递`buffer.Start`，意味着“我们什么都还没使用”——及时我们能够检查这段数据，它也依然会留存在pipe中以供后续读取。我们也可以获取缓冲区中任意的`SequencePosition` 值——例如如果我们读取20字节——所以我们可以完全控制有多少数据被从pipe中丢弃。这里有两种方法取得`SequencePosition` ：

* 你可以就像`Slice(...)`一个 `Span<T>` o或者`Memory<T>`一样`Slice(...)`一个`ReadOnlySequence<byte>` ——然后访问子集中的`.Start`或`.End`
* 你可以使用`ReadOnlySequence<byte>`中的`.GetPosition(...)` 方法，它返回一个相关位置而*无需*真正分割

更微妙的是：我们可以分别告诉它我们消费了一些数量，但是我们已检查了另一个不同的数量，这里最常见的例子是表达“你可以丢弃这么多——这些我做完了；但是我看完了所有的数据，我此时无法处理——我需要更多数据（you can drop *this much* - I'm done with that; but I looked at everything, I can't make any more progress at the moment - I need more data）”，具体来说：

``` csharp
reader.AdvanceTo(consumedToPosition, buffer.End);
```

这里正是`PipeWriter.FlushAsync()`和`PipeReader.ReadAsync()`微妙的相互作用出场的地方了，我之前跳过了`PipeWriter.FlushAsync()`，它实际上在一次调用里提供了两个功能：

* 如果存在一个`ReadAsync` 调用，它会被注意到，因为它需要数据，然后它唤醒reader，使读取循环继续
* 如果writer快过reader，比如pipe中充满了没有被reader清楚的数据，它会挂起writer(通过同步的not completing)——当pipe有了更多空间后，才会被重新激活(writer挂起/恢复的阈值可以在创建Pipe实例时被指定)

显然, 这些概念在我们的示例中没有发挥作用, 但它们是Pipelines工作原理的核心思想。将数据推送回pipe的能力极大地简化了大量 IO 场景。实际上, 我在有pipelines之前看到的每一个协议处理代码都有大量的代码与处理不完整数据的积压有关——它是这样一个重复的逻辑, 我非常高兴地看到它能在框架中被处理得很好。

### “唤醒”或者说“响应式”指的是什么

你可能会注意到，我并没有真正定义我之前表达的意思，在表层上，我的意思是：对于`ReadAsync` 或`FlushAsync` 的一个await操作在其返回之前是未完成的，然后现在异步延续被产生，允许我们的async方法恢复执行，是，没错，不过这只是重新说明了 `async`/`await` 是什么意思。但是我debug的重点关注在于代码运行于哪个线程上——原因我会在之后的系列中讨论。所以说  "异步延续被产生 " 对我来说还不够。我想了解是谁在调用它, 就线程而言。最常见的答案是：

* 它通过`SynchronizationContext` 委托（注意：在许多系统中*没有*`SynchronizationContext` ）
* 触发状态更改的线程会在状态更改时使用, 以产生延续
* 全局线程池会被用来产生延续

在某些情况下，所有这些都可以是没问题的，而在某些情况下，所有这些都可能是糟糕的！同步上下文是一种完善的机制，可以从工作线程返回到主应用程序线程 (例外：桌面应用程序中的 UI 线程)。然而，它是没有必要的如果只是说我们完成了一个IO操作然后准备跳回一个应用线程；并且这么做会实际上将大量IO代码和数据处理代码转移到应用线程——这通常是我们想要避免的。并且，如果应用代码在异步调用时使用了`Wait()`或`.Result`会导致死锁（假设你不是故意的）。第二种选项（“内联”地在一个触发它的线程上执行回调）可能会有问题，因为它可以偷取你想要用来做别的事的线程（并且有可能导致死锁）；并且在某些极端情况下，当两个异步方法本质上作为协程运行时，可能会导致stack-dive（最终栈溢出）。最后一个选项 (全局线程池) 没有前两个的问题, 但在某些负载条件下可能会遇到严重问题——我将在本系列后面的部分讨论这一点。

但是好消息是，pipelines在这里给了你控制权。当创建Pipe实例时，我们可以提供`PipeScheduler` 实例给reader和writer（分别地）使用。`PipeScheduler` 用来执行这些激活。如果没有制定，那么它默认受i按检查`SynchronizationContext`，然后使用全局线程池使用“内联”延续（使用那个导致状态改变的线程）作为另一个可用选项。但是：*你可以提供你对于`PipeScheduler`自己的实现*，给予你对线程模型的完全控制。

### 总结

所以：我们已经研究了什么是`Pipe` ，和我们怎样才能用`PipeWriter`写入一个pipe，和用`PipeReader` 从pipe中读取——和怎样"advance"二者。我们已经研究了其于Stream的相似和差异，我们讨论了`ReadAsync()`和 `FlushAsync()` 怎样交互控制writer和reader的分片执行。我们研究了通过pipe提供所有缓冲区后，对缓冲区的责任怎样被反转——和pipe怎样简化了积压数据的管理。最终，我们讨论了激活对`await`操作的延续进行激活的线程模型。

这对于第一步来说可能已经足够了。在之后，我们将研究pipelines工作时的内存模型——比如数据存活在哪里。我们也将研究*如何在现实场景中利用pipelines来开始做些有趣的东西*。
