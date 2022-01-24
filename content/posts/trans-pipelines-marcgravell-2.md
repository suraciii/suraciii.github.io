---
title: Pipelines - .NET中的新IO API指引(二)
date: 2018-07-17T00:00:00Z
---


原文：[Pipelines - a guided tour of the new IO API in .NET, part 2](https://blog.marcgravell.com/2018/07/pipe-dreams-part-2.html)

作者：marcgravell

在[上一章](https://blog.marcgravell.com/2018/07/pipe-dreams-part-1.html)，我们讨论了以往的`Stream`API中存在的一些问题，并且介绍了`Pipe`,`PipeWriter`,`PipeReader` 等API，研究如何写出一个`Pipe` 并且从中消费数据，我们也讨论了`FlushAsync()` 和`ReadAsync()` 是如何协同保证两端的工作，从而解决“空”和“满”的场景——在没有数据时挂起reader，并在数据到来时恢复它；在写入快过读取(Pipe满载)时挂起writer，并在reader追上后恢复它；并且我们也在线程模型的层面上探讨了什么是“挂起”。

在这章，我们将会研究pipelines的内存模型：数据实际上存在于哪里？。我们也会开始着手研究如何在现实场景中使用pipelines以满足真实需求。

### 内存模型：我的数据在哪里？

在上一章，我们讲了pipe如何管理所有的缓冲区，允许writer通过 `GetMemory()`和`GetSpan()`请求缓冲区，随后通过`ReadAsync()`中的 `.Buffer` 将提交后的数据暴露给reader——reader取得的数据是一个 `ReadOnlySequence<byte>`，即所有数据的几个片段。

那么其中究竟发生了什么？

每一个`Pipe`实例都有一个引用指向`MemoryPool<byte>`——一个[`System.Memory`](https://www.nuget.org/packages/System.Memory/) 中的新东西，顾名思义，它创建了一个内存池。在创建`Pipe`的时候，你可以在选项中指定一个专门的 `MemoryPool<byte>`，但是在默认情况下(我猜也是大多数情况下)——应该是使用一个应用级别共享的 (`MemoryPool<byte>.Shared`) 内存池。

`MemoryPool<byte>` 的概念是非常开放的。其*默认*的实现是简单地使用`ArrayPool<byte>.Shared` (应用级别的数组池)，在需要的时候租借数组，并在使用完后归还。这个 `ArrayPool<T>` 使用了 `WeakReference`来实现，所以池化的数组在内存有压力时是可以回收的，但是，当你请求`GetMemory(someSize)` 或者 `GetSpan(someSize)`时，它并不是简单地向内存池请求“someSize”，相反，它在内部追踪了一个“片段(segment)”，一个新“片段”将是（默认情况下，可以通过配置改变）someSize和2048字节中的最大值，这样请求一个大小可观的内存意味着我们的系统不会充满着许多小数组，而后者会对GC造成显著碰撞。当你在writer中 `Advance(bytesWritten)`，它：

* 移动一个表达当前已使用多少片段的内部计数器
* 更新reader的”备读(available to be read)“链的末端；如果我们刚刚对一个空片段的第一个字节进行了写入，这意味着将会向链中增加一个新片段，否则，它意味着当前链的结尾标志被增加（后移）

这就是我们从 `ReadAsync()`中获取到的”备读“链；而当我们在reader中 `AdvanceTo` ——如果整个片段都被消费掉了，那么pipe会将这些片段送回内存池。在那里，它们可以被多次复用。并且作为上述两点导致的直接结果，我们可以看到在大多数情况下(即使在writer中多次调用`Advance` )，我们最终可以在reader中发现一个单独的片段；而在片段边界处，或reader落后于writer，数据开始累积的情况下，会有多个片段。

只有使用默认池才能：

* 我们不用在每次调用`GetMemory()` / `GetSpan()`时都要分配内存
* 我们不需要每次`GetMemory()` / `GetSpan()`都要有一个单独的数组——通常我们只是获得同样的”片段“中的某个不同的范围
* 只使用少量的大缓冲数组
* 它们不需要大量的类库代码，就可以自动回收
* 当不再需要时，它们可以被GC回收



这也解释了为什么在`GetMemory()` / `GetSpan()`中请求少量空间再在之后检查其大小的举动是有效的：我们可以访问*当前段的剩下未使用的部分*。这意味着：一个大小为2048的片段，在之前的写入中用掉了200字节——即使我们只请求5字节，我们也可以看到我们还剩下1848字节可供使用，或者更多——记住：从`ArrayPool.Shared` 中获取到的数组也是一个”至少这么大“的操作。

### 零复制缓冲区

在此还有需要注意的地方是，我们获取数据缓冲的时候，*没有进行任何数据的复制*。writer申请一个缓冲区，然后第一次写入数据到需要的位置。这就成了writer和reader之间的缓冲区，无需复制数据。而如果reader当前无法处理完所有的数据，它能够通过显示声明其”未被消费“地方式将数据放回pipe。这样无需为reader维护一个单独的数据积压处，而这在使用`Stream`的协议处理代码中是*非常*常见的。

正是这种功能间的组合使得pipeline代码在内存层面显得非常友好。你可以用`Stream`做到所有的这些，但是却需要大量令人痛苦的易出错的代码去实现，如果你想做好，甚至需要更多——并且你几乎必须去为每个场景单独地实现它。Pipelines让良好的内存处理变为默认的简单的途径——落入成功之中

### 更多奇特的内存池

你并不受限于使用我们之前讨论的内存池；你可以实现你自己的自定义内存池！默认内存池的优点在于它很简单。尤其是我们是否100%完美地返回每个片段并不重要——如果我们以某种方式丢弃某个pipe，最坏的情况会是GC将在某个时刻回收掉被丢弃的片段。它们不会回到池中，但那没关系。

但是，你可以做很多有趣的东西。想象一下，比如一个 `MemoryPool<byte>`承载巨量的内存——通过一些非常大的数组得到的托管内存，或是通过 `Marshal.AllocHGlobal` 获得的非托管内存（注意 `Memory` 和 `Span` 并*不受限于*数组——它们需要的不过是某种连续内存），按需使用这些巨大的内存块。这有很大的潜在场景，但是它会使片段的可靠回收变得更加重要。大多数系统不应该这么做，但是提供这样的灵活性是好的。

### 在真实系统中有用的pipes

我们在第一部分中用的例子，是一个读写均在同一代码的单独`Pipe`。很明显这不是个真实场景（除非我们是在试图模拟一个"echo"服务器），所以我们在更真实的场景中可以做什么呢？首先，我们需要把我们的pipelines连接到什么东西上。我们通常并不想单独地使用Pipe，相反，我们希望可以有一个*结合一个普遍的系统或API使用*的pipe。所以，来让我们开始看看接下来会是什么样子吧。

在这里，我们需要注意：发布于.NET Core 2.1的pipelines不包括任何终端实现。这意味着： `Pipe` 虽然存在，但是*在框架内*没有提供任何的与现有系统的实际连接——就像提供了抽象的 `Stream` 基类，却没有 `FileStream`,，`NetworkStream`等。是的，这听起来让人感到失望，但是这只是由于时间限制，不要慌！现在在进行一些关于它们应该以哪种优先级实现的“活跃的”讨论。并且现在有少量的社区贡献来补足最明显的缺陷。

一旦我们处于那些场景，我们可能会问：“将pipelines连接到另一个数据后端需要什么？”

也许将一个pipe连接到一个 `Stream`会是一个不错的开头。我知道你在想：“但是Marc，你在上一章你不遗余力地再说 `Stream` 有多么糟糕！”。我没有改变我的看法，它不一定是完美的——对于那些特定场景的`Stream`实现（比如`NetworkStream`或`FileStream`）我们可以有一个专门的基于pipelines的终端直接与那个服务以最小的中转进行通讯；但是这是一个有用的起步：

* 它使我们可以立即访问到巨量的API——任何可以通过`Stream`暴露数据，或任何通过封装的streams作为中间层的API（加密、压缩等）
* 它将所有老旧的`Stream`API隐藏在一个明确清晰的表层下
* 它带来了*几乎所有*我们之前提到过的优点

所以，让我们开始吧！我们首先要思考的是：这里的*方向*是什么？就像刚才提到的一样，`Stream`是模糊不清的——可能只读，只写，或可读可写。来假设我们想解决的是最通常的问题：一个可读可写表现为双工行为的stream——这可以让我们访问如sockets(通过`NetworkStream`)之类的东西。这意味着我们实际上将会需要*两个*pipe——一个用来输入，一个用来输出。Pipelines通过明确地声明`IDuplexPipe`接口来帮助我们指明道路。这是一个非常简单的接口，数据传输给`IDuplexPipe`就像传输给两个pipe的端点一样——一个标记为"in"，一个标记为"out"：

```csharp
interface IDuplexPipe
{
    PipeReader Input { get; }
    PipeWriter Output { get; }
}
```

我们接下来想要做的是创建一个类来实现 `IDuplexPipe`，但是其内部使用两个`Pipe`实例：

* 一个`Pipe`会是输出缓冲区（从消费者的角度来看），它将会在调用者写入`Output`是被填充——并且我们将会用一个循环来消费这个`Pipe`并且将数据推入底层`Stream`(被用来写入网络，或者其它任何stream可以写入的)
* 一个`Pipe`将会是输入缓冲区（从消费者的角度来看），我们将有一个循环来从底层`Stream`*读取*数据，并将其推入`Pipe`，它将会在调用者从`Input`中读取时排出

这个方法可以立即解决普遍影响着那些使用`Stream`的人*一大堆*的问题：

* 我们现在有了input/output缓冲区，用于从读/写调用中解耦stream访问，而不用添加`BufferedStream`或是其它类似的防止数据碎片的功能（对于写入代码来说）,并且这将会使我们在处理数据时很方便去接收更多数据（特别是对于读取代码来说，这样我们不用在请求更多数据时保持暂停）
* 如果调用代码的写入快过stream的`Write`可以处理的程度，背压特性将会展现出来，对调用代码进行节流，这样我们不会被充满未发送数据的巨大缓冲区所终结
* 如果stream的`Read`超过了消费这些数据的调用代码，背压特性也会在这里出场，对我们的stream读取循环进行节流，这样我们不会被充满未处理数据的巨大缓冲区所终结
* 读取和写入代码都会受益于我们之前所讨论的内存池的所有优点
* 调用代码从来不用担心数据的后备存储（未完成帧）等——pipe去解决它

### 那么它看起来会是什么样？

基本上，我们需要做的就是这样：

```csharp
class StreamDuplexPipe : IDuplexPipe
{
    Stream _stream;
    Pipe _readPipe, _writePipe;

    public PipeReader Input => _readPipe.Reader;
    public PipeWriter Output => _writePipe.Writer;
    
    // ... more here
}
```

注意我们有两个不同的pipe；调用者获取每个pipe的一个端点——然后我们的代码将会操作每个pipe的*另一个*端点。

### 对pipe进行抽取

那么我们与stream交互的代码是什么样的呢？像之前说过的那样，我们需要两个方法。首先——很简单——一个循环，从`_stream`中读取数据并且将其推入`_readPipe`，然后被调用代码所消费；这个方法的核心类似这样：

```csharp
while (true)
{
    // note we'll usually get *much* more than we ask for
    var buffer = _readPipe.Writer.GetMemory(1);
    int bytes = await _stream.ReadAsync(buffer);
    _readPipe.Writer.Advance(bytes);
    if (bytes == 0) break; // source EOF
    var flush = await _readPipe.Writer.FlushAsync();
    if (flush.IsCompleted || flush.IsCanceled) break;
}
```

这个循环向pipie请求一个缓冲区，然后用 `netcoreapp2.1` 中`Stream.ReadAsync` 的新重载接收一个 `Memory<byte>` 来填充缓冲区——我们一会儿讨论如果你现在没有一个能接收 `Memory<byte>` 的API该怎么办。当读取完成后，它使用`Advance`向pipe提交这个数量的字节，然后它在pipe上调用 `FlushAsync()` 来（如果需要的话）唤醒reader，或者在背压减轻时暂停写循环。注意我们还需要检查`Pipe`的 `FlushAsync()`的结果——它可以告诉我们pipe的消费者已经告知其已经读取完了所有想要的数据（`Iscompleted`），或者pipe本身被关闭（`IsCanceled`）。

注意在这两种情况下，我们都希望确保在此循环退出时告诉管道，这样我们就不会最终在没有数据到来时永远在调用端等待下去。意外发生时，或者有时在调用 `_stream.ReadAsync` （或其它方法）时，可能会有异常抛出，所以最好是利用`try`/`finally`：

```csharp
Exception error = null;
try
{
    // our loop from the previous sample
}
catch(Exception ex) { error = ex; }
finally { _readPipe.Writer.Complete(error); }
```

如果你愿意的话，你可以使用两个 `Complete` ——一个在try末尾（成功时），一个在catch中（失败时）。

我们需要的第二个方法会比较复杂。我们需要一个循环来从`_writePipe`中消费数据，然后将其推入`_stream`。核心代码会像这样：

```csharp
while (true)
{
    var read = await _writePipe.Reader.ReadAsync();
    var buffer = read.Buffer;
    if (buffer.IsCanceled) break;
    if (buffer.IsEmpty && read.IsCompleted) break;

    // write everything we got to the stream
    foreach (var segment in buffer)
    {
        await _stream.WriteAsync(segment);
    }
    _writePipe.AdvanceTo(buffer.End);
    await _stream.FlushAsync();    
}
```

这会等待一些数据（可能在多个缓冲区里），然后进行一些退出判断检查；像之前一样，我们可以在`IsCanceled`时放弃，但是下一个检查会比较微妙：我们不希望只因为*producer*表示它们已经写入了所有想要的数据（`Iscompleted`）就停止写入，不然我们也许会丢失它们末尾几段数据——我们需要继续直到我们已经写入了它们所有的数据，直到`buffer.IsEmpty`。这是个简化后的例子，因为我们一直写入所有数据——我们之后会看到更复杂的例子。一旦我们有了数据，我们按顺序将每个非连续缓冲区写入stream中——因为`Stream`一次只能写入一个缓冲区（同样，我使用的是`netcoreapp2.1`中的重载，接受`ReadOnlyMemory<byte>`参数，但是我们不限于此）。一旦它写完了缓冲区，它告诉pipe我们已经消费完了所有数据，然后刷新(flush)底层的`Stream`。

在“真实”代码中，我们*也许*希望更积极地优化从而减少刷新底层stream直到我们知道再也不会有可读取地数据，也许 在`_writePipe.Reader.ReadAsync()`之外可以使用`_writePipe.Reader.TryRead(...)` 。这个方法地工作方式类似 `ReadAsync()`但是保证会同步返回——用来测试“在我忙的时候writer是否附加了什么？”。但是上面的内容已经讲述了这一点。

另外，像之前一样，我们也许需要添加一个 `try`/`finally`，这样在我们退出时总是会调用`_writePipe.Reader.Complete()`。

我们可以使用 `PipeScheduler` 来启动这两个泵(pumps)，这会确保它们在预期环境中运行，然后我们的循环开始泵送数据。我们要添加*一些*格外的内容（我们可能需要一种机制来 `Close()`/`Dispose()` 底层stream等）——但是像你所看到的，将 `IDuplexPipe` 连接到没有pipeline设计的源不需要是一项*艰巨*的任务。

### 这是我之前做的...

我已经将上面的内容简化了一些（说真的，不是太多），以便让它适合讨论，但是你可能仍然不应该从这里复制粘贴代码来尝试让它工作。我并没有声称它们时适用于所有情况的完美解决方案，但是作为[StackExchange.Redis 2.0版](https://github.com/StackExchange/StackExchange.Redis/issues/871)工作的一部分，我们实现了一系列pipelines的绑定放在nuget上——毫无创意地命名为 `Pipelines.Sockets.Unofficial` （[nuget](https://www.nuget.org/packages/Pipelines.Sockets.Unofficial/),github(https://github.com/mgravell/Pipelines.Sockets.Unofficial)，它包括：

* 将双工的`Stream`转换为 `IDuplexPipe` （就像上面说的）
* 将只读`Stream`转换为`PipeReader`
* 将只写`Stream`转换为`PipeWriter`
* 将 `IDuplexPipe` 转换为双工的`Stream`
* 将`PipeReader`转换为只读`Stream`
* 将`PipeWriter`转换为只写`Stream`
* 将`Socket`直接转换成`IDuplexPipe`（不经过`NetworkStream`）

前六个在 `StreamConnection`的静态方法中，最后一个在`SocketConnection`里。

`StackExchange.Redis` 牵涉着大量`Socket`工作，所以我们对如何将pipeline连接到socket上非常感兴趣，对于没有TLS的redis连接，我们可以直接将我们的`Socket`连接到pipeline：

* `Socket`  ⇔ `SocketConnection`

对于需要TLS的redis连接（比如云redis提供商），我们可以这样连接：

- `Socket` ⇔ `NetworkStream` ⇔ `SslStream` ⇔ `StreamConnection`

所有这两种配置都是一个`Socket`在其中一端，一个`IDuplexPipe`在另一端，它开始展示我们如何将pipeline作为更复杂系统的一部分。也许更重要的是，它为我们在未来实施改变提供了空间。将来有可能的例子：

* Tim Seaward一直在折腾[`Leto`](https://github.com/Drawaes/Leto)，它提供了不需要 `SslStream` ，直接用`IDuplexPipe`实现TLS的能力（并且不需要stream逆变器）
* 在 Tim Seaward，David Fowler 和Ben Adams之间，有*一系列*直接实现pipelines而不用托管sockets的实验性/正在进行的网络层工作，包括"libuv"，"RIO"（Registerd IO），和最近的"magma"——它将整个TCP栈推入用户代码从而减少系统调用。

看这个空间如何发展将会非常有趣！

### 但是我当前的API不会使用 `Span` 或者 `Memory`！

当在写将数据从pipe中泵送到其它系统（比如一个`Socket`）时，很有可能你会遇到不接收 `Span` 或者 `Memory`的API。不要慌，这没有大碍，你依然可以有很多种变通方案使其变得更……传统。

在你有一个 `Memory` 或者 `ReadOnlyMemory`时，第一个技巧是`MemoryMarshal.TryGetArray(...)`。它接收一个*memory*并且尝试获取一个`ArraySegment` ，它用一个`T[]`vector和一个`int`偏移/计数对描述相同的数据。显然，这只有在这块内存*是基于*一个vector时才能用，而情况并非总是如此，所以这可能会在异种的内存池上失败。我们第二个解决办法时`MemoryMarshal.GetReference(...)`，它接受一个*span*然后返回一个原始数据起点的引用（实际上是一个“托管指针”，又叫做 `ref T`）。一旦我们有了一个 `ref T`，我们可以用`unsafe`语法来获得一个这个数据的非托管指针，在这种情况下会有用：

```csharp
Span<byte> span = ...
fixed(byte* ptr = &MemoryMarshal.GetReference(span))
{
    // ...
}
```

即使span的长度是零，你依然可以这么做，其会返回一个第0项*将会存在*的位置，而且甚至在使用`default`span即根本没有实际后备内存的时候，也可以这么使用。后面这个有一点需要注意，因为`ref T`*通常不被认为会是null*，但是在这里它是。实际上，只要你不去尝试对这种空引用进行解引用，不会有什么问题。如果你使用`fixed`将其转换为一个非托管指针，你会得到一个空（零）指针，这相对来说更合理（并且在一些`P/Invoke`场景中会有用），`MemoryMarshal` 本质上是`unsafe` 代码的同义词，即使你调用的那段代码并没有使用`unsafe` 关键字。使用它是完全有效的，但是如果不恰当地使用它，它可能会坑到你——所以小心就是了。

### Pipe的应用端代码是什么样的？

OK，我们有了`IDuplexPipe`，并且我们也看到了如何将两个pipe的“业务端”连接到你选择的后端数据服务。现在，我们在应用代码中如何使用它？

按照我们上一章的例子，我们将从 `IDuplexPipe.Output` 中把`PipeWriter`传递给我们的出站代码，从 `IDuplexPipe.Input` 中把 `PipeReader` 传递给我们的入站代码。

*出站*代码相当简单，并且通常是需要直接从基于`Stream`的代码移植成基于`PipeWriter`的代码。关键的区别还是那样，即*你不再手动控制缓冲区*。下面是一个一个典型的实现：

``` csharp
ValueTask<bool> Write(SomeMessageType message, PipeWriter writer)
{
    // (this may be multiple GetSpan/Advance calls, or a loop,
    // depending on what makes sense for the message/protocol)
    var span = writer.GetSpan(...);
    // TODO: ... actually write the message
    int bytesWritten = ... // from writing
    writer.Advance(bytesWritten);

    return FlushAsync(writer);
}
```

``` csharp
private static async ValueTask<bool> FlushAsync(PipeWriter writer)
{
    // apply back-pressure etc
    var flush = await writer.FlushAsync();
    // tell the calling code whether any more messages
    // should be written
    return !(flush.IsCanceled || flush.IsCompleted);
}
```

`Write` 的第一部分是我们的业务代码，我们需要把数据从writer写入到缓冲区；通常这会多次调用 `GetSpan(...)` 和 `Advance()`。当我们写完了数据，我们可以flush它从而保证启动泵送并且应用背压控制。对于那些非常大的消息体，我们*也可以*在中间点flush，但是对于大多数场景：一个消息flush一次足够了。

如果你好奇为什么我将`FlushAsync` 分割到不同的代码中：那是因为我想`await` `FlushAsync`的结果来检查退出条件，所以它需要在一个`async` 方法里，在这里最有效率的访问内存方式是通过 `Span<byte>` API，`Span<byte>` 是一个 `ref struct` 类型，因此我们[不能在异步方法中将 `Span<byte>` 作为局部变量使用](https://github.com/dotnet/csharplang/blob/master/proposals/csharp-7.2/span-safety.md)。一个实用的办法是简单地分割代码，这样一个方法做 `Span<byte>` 工作，一个方法做`async`方面的工作。

### 发散一下：异步代码、同步热路径和异步机制开销

 `async` / `await` 中引入的机制非常棒，但是它仍然会是一个会产生惊人栈开销的工作——你可以从 [sharplab.io](https://sharplab.io/#v2:D4AQDABCCMCsDcBYAUCkBmKAmCB5ArgE4DCA9gCYCmKA3ihAxAA6ECWAbgIYAulU0ANigAOCADVOAG3yUQAgDwAjUqUkA+CADFpAZwAWAQR0BPAHYBjABQAFVk0oB1Nr0IQA7s8qEAlPUZ1kRiCIAHoQiE4mJkljCEVOcwBrAFoWSh0dIj5KbnM/YIguVwAzXT0IAF4oAE53T0IAOm18fSMzK28kQILQ8N5JSQhuPT5zKUlWUwBzCHMKPjcR4a8I01iAW1JCPnX0nU4p9PzgsIh9UnxJcjiF515TY6CQAHYIAEJLUpa9BoBJHWInAslEklGuwGAEC++j+ANI62iOTBnWOAF8UOjUFjTjomCpimCoVshiMIJQAB6cBGglCTFymKTYCC2exOVguWjHDDiKQyOTyZr6ABK6Uu3A0gsMJgslm8lQ0VGKnDFXUxOm4hHw5m4WjKIsykm4nO6DG5ylUEH+gOBoOuFQVlCVKq5mHNgyt8MRvDtDqdhtVQA=) 中看到——看看`OurCode.FlushAsync` 中生成的机制——和整个 `struct <FlushAsync>d__0`。现在，这些代码并*不是很糟糕*——它非常努力地尝试在同步路径上避免内存分配——但是*没有必要*。

这里有两种方法可以显著地改善它；一个是压根不去 `await` ，通常如果 `await` 是在方法中地最后一行并且**我们不需要去处理结果**：不去 `await` ——只要去除`async`然后`return`这个task——完成或者未完成。在这里我们没办法这样做，因为我们需要去检查返回的状态，但是我们可以通过检查这个task是否*已经完成*来对成功的结果进行优化（通过 `.IsCompletedSuccessfully` ——如果它已经结束但是有错误，我们仍然需要使用`await`来让异常可以正确表现出来）。如果它*是*成功完成的，我们可以请求到`.Result`。所以我们*也*可以将`FlushAsync` 写成这样：

``` csharp
private static ValueTask<bool> Flush(PipeWriter writer)
{
    bool GetResult(FlushResult flush)
        // tell the calling code whether any more messages
        // should be written
        => !(flush.IsCanceled || flush.IsCompleted);

    async ValueTask<bool> Awaited(ValueTask<FlushResult> incomplete)
        => GetResult(await incomplete);

    // apply back-pressure etc
    var flushTask = writer.FlushAsync();

    return flushTask.IsCompletedSuccessfully
        ? new ValueTask<bool>(GetResult(flushTask.Result))
        : Awaited(flushTask);
}
```

这在大多数情况（同步完成）下*完全避免*了`async`/`await` 机制——如我们再次在 [sharplab.io](https://sharplab.io/#v2:D4AQDABCCMCsDcBYAUCkBmKAmCB5ArgE4DCA9gCYCmKA3ihAxAA6ECWAbgIYAulU0ANggA1TgBt8lEAIA8AI1KkxAPggAxCQGcAFgAoACqyaUA6m16EIAd3OVCASnqM6yRm4gKlEAOKVuAJUpNfDFuXQ18HUDg0IgAMy1tR1d3VIB6NIheMTEs7T4AY3ExVgA7AHMIAoo+K3zufMtOUoBPCABbUkI+dqDNTnKgp1S3DIgdUhDyD1rzXlLhkYYAXlUAQl0EyO0AOgBJTWJmgsoxSmngYHjE/cPSdqYz3nJ7JFQU1JAADhFxSWl5IoVBAAIJWTisZ66UQSKSyCJRIIhbiqMrVB5PSjJJZuVY+PzRZG6EAATggaPujz8WLei1GmU4TEebTknAKAGsALQsPpEPh+Ap0xhcSxbHTSCDLay2Qg7BHaEGaFqlAq6V4oIUMEAAdmu22ktzIGOp5AAyvgCidNJo4iExC1Ne4APwQUqUKy/WEAzwqXS+AJI0KbRIGwmhezYnEMABcoPBkPOwf1AnVHwgAF8UJn3igxpomIo4ud4l08vyAB6cY0oMoWUribAQQzGMwJwi0RYYT3/eGJMMo9SJRXK1X2SWqKhxTjIt7ZzTcQgW7iD7b9jtprs+iAHI4q07FvGT6ehN5uTdA7d3Y3PccQI8zrNAA=)中看到的一样。我要强调：如果代码是经常（或仅仅）进行*真正的异步行为*时，这样做是完全没有必要的；它*只*对于那些结果通常（或仅仅）会同步地产生时才有帮助。

(译注：对于`ValueTask`的"hot path"场景的使用，这里有个视频讲过一些，以及其它一些.NET中新的优化性能的方法： [Adam Sitnik - State of the .NET Performance](https://www.youtube.com/watch?v=dVKUYP_YALg))

### 那么Reader呢？

就像我们多次看到的一样，reader总是稍微复杂一些——我们无从得知一个单独的“读”操作是否会准确包含一个入站消息，我们也许需要开启循环直到我们获取到了所有所需的数据，并且我们也许需要推回一些*额外的*数据。因此，让我们假设我们想要消费某种单一的消息： 

```csharp
async ValueTask<SomeMessageType> GetNextMessage(
    PipeReader reader,
    CancellationToken cancellationToken = default)
{
    while (true)
    {
        var read = await reader.ReadAsync(cancellationToken);
        if (read.IsCanceled) ThrowCanceled();

        // can we find a complete frame?
        var buffer = read.Buffer;
        if (TryParseFrame(
            buffer,
            out SomeMessageType nextMessage,
            out SequencePosition consumedTo))
        {
            reader.AdvanceTo(consumedTo);
            return nextMessage;
        }
        reader.AdvanceTo(buffer.Start, buffer.End);
        if (read.IsCompleted) ThrowEOF();        
    }
}
```

这里我们从pipe中获取了*一些*数据，进行退出检查（比如取消）。然后我们*尝试寻找一个消息*，这是什么意思取决于你具体的代码——它可以是：

* 从缓冲区中寻找某些特定的值，比如一个ASCII行尾，然后把所有到这里的数据当作一个消息（丢弃行尾）
* 解析一个定义良好的二进制帧头，获取其内容长度，通过检查获取这样长度的数据然后处理
* 或者其它你需要的！

如果我们*能够*获取到一个消息，我们可以告诉pipe令其丢弃我们已经消费过的数据——通过 `AdvanceTo(consumedTo)`，在这里使用我们自己的帧解析代码告诉我们消费了多少。如果我们*没能*获取一个消息，我们要做的第一件事就是告诉pipe我们什么也没消费，尽管我们尝试读取了所有数据——通过 `reader.AdvanceTo(buffer.Start, buffer.End)`。在这里，会有两种可能：

* 我们还没有获得足够的数据
* pipe已经死亡，我们*再也不会*获得足够的数据

我们在通过 `read.IsCompleted` 检查了这些，在第二种情况时报告错误；否则我们继续循环，等待更多数据。那么剩下的，就是我们的帧解析——我们已经把复杂的IO管理降低成了简单的操作；比如，如果我们的消息是以行标记分隔：

``` csharp
private static bool TryParseFrame(
    ReadOnlySequence<byte> buffer,
    out SomeMessageType nextMessage,
    out SequencePosition consumedTo)
{
    // find the end-of-line marker
    var eol = buffer.PositionOf((byte)'\n');
    if (eol == null)
    {
        nextMessage = default;
        consumedTo = default;
        return false;
    }

    // read past the line-ending
    consumedTo = buffer.GetPosition(1, eol.Value);
    // consume the data
    var payload = buffer.Slice(0, eol.Value);
    nextMessage = ReadSomeMessageType(payload);
    return true;
}
```

这里`PositionOf` 尝试获取第一个行标记的位置。如果一个也找不到，我们就放弃，否则我们将`consumedTo` 设为”行标记+1“（即我们会消费行标记），然后我们分割我们的缓冲区来创建一个子集，表示*不包括*行标记的内容，这样我们就可以解析了。最终，我们报告成功，并且庆祝我们可以简单地解析Linux风格的行尾。

### 这里的重点是什么？

用这些*和大多数最简单最简朴的`Stream`版本（没有任何nice的特性）非常相似*的最少量的代码，我们的应用现在有了一个reader和writer，利用广泛的能力确保高效和有效的处理。你可以用`Stream`*来做所有的这些事*，但是这样*真的、真的很难*去做好做可靠。通过将所有的这些特性集成进框架，许多代码都可以受益于这一单独的实现。并且它也给了那些直接在pipeline API上开发并且对自定义pipeline端点和修饰感兴趣的人更多的未来空间。

### 总结

在这节，我们研究了pipeline使用的内存模型和其如何帮助我们避免分配内存，然后我们研究了怎样才可以将pipeline与现有的API和系统（如`Stream`）进行交互——并且我们介绍了 `Pipelines.Sockets.Unofficial` 这样的可用的工具库。我们研究了在不支持 span/memory 代码的API上集成它们的可用选项，最终我们展示了和pipeline交互的*真正的调用代码*是什么样子的（并且简单地介绍了如何优化那些通常是同步的`async`代码）——展示了我们的*应用代码*会是什么样子。在最后一部分，我们将会研究如何在开发现实中的库，比如`StackExchange.Redis时`，将我们学到的这些知识点联系起来——讨论我们在代码里需要解决哪些复杂点，而pipeline又如何将它们变得简单。