---
title: "使用SemanticKernel集成通义千问语言大模型"
date: 2024-03-07T00:00:00Z
draft: false
---

SemanticKernel是一个由微软开发的开源SDK，它可以将常用编程语言和大模型结合，构建AI代理来执行复杂任务（类似LangChain）。

SemanticKernel目前官方只支持集成OpenAI（包括Azure OpenAI）和Hugging Face，这篇文章介绍如何通过SemanticKernel集成其它大模型（以阿里的通义千问为例）

SemanticKernel支持C#、Python和Java，但是目前只支持C# SDK接入自定义大模型。

通义千问可以通过阿里云的模型服务灵积(DashScope)或者百炼平台接入，这里使用DashScope，因为DashScope可以使用ApiKey认证，比较方便。

SemanticKernel集成自定义LLM主要需要三步：
1. 实现对应的LLM接口客户端
2. 根据需要的功能，实现`ITextGenerationService`,`IChatCompletionService`,`ITextToImageService`等接口，在其中调用LLM相关接口功能
3. 注册模型服务

## 实现`DashScopeClient`

下面是一个实现文本生成功能的代码：
```csharp
public async Task<IReadOnlyList<TextContent>> GenerateTextAsync(
	string prompt,
	PromptExecutionSettings? executionSettings,
	CancellationToken cancellationToken)
{
	var modelId = executionSettings?.ModelId ?? _modelId;
	var endpoint = GetTextGenerationEndpoint(); // https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation
	var request = CreateTextRequest(modelId, prompt, executionSettings); // 参考DashScope中的API文档
	using var httpRequestMessage = this.CreatePost(request, endpoint, _apiKey);

	string body = await SendRequestAndGetStringBodyAsync(httpRequestMessage, cancellationToken)
		.ConfigureAwait(false);

	var res = DeserializeResponse<TextGenerationResponse>(body); // 参考DashScope中的API文档
	if (res.ErrorMessage != null) throw new KernelException($"Error from model: {res.ErrorMessage}, code: {res.ErrorCode}");
	if (res.Output!.Choices is null) return [];

	return res.Output!.Choices.Select(choice => new TextContent(choice.Message.Content, modelId, choice, Encoding.UTF8)).ToList();
}
```

## 实现`ITextGenerationService`

```csharp
public DashScopeTextGenerationService(
	string model,
	string apiKey,
	Uri? endpoint = null,
	HttpClient? httpClient = null,
	ILoggerFactory? loggerFactory = null)
{
	Verify.NotNullOrWhiteSpace(model);

	Client = new DashScopeClient(
		modelId: model,
		endpoint: endpoint ?? httpClient?.BaseAddress,
		apiKey: apiKey,
		httpClient: HttpClientProvider.GetHttpClient(httpClient),
		logger: loggerFactory?.CreateLogger(GetType()) ?? NullLogger.Instance
	);

	AttributesInternal.Add(AIServiceExtensions.ModelIdKey, model);
}

/// <inheritdoc />
public Task<IReadOnlyList<TextContent>> GetTextContentsAsync(string prompt, PromptExecutionSettings? executionSettings = null, Kernel? kernel = null, CancellationToken cancellationToken = default)
	=> Client.GenerateTextAsync(prompt, executionSettings, cancellationToken);
```

## 注册已实现的模型服务

```csharp
public static class DashScopeKernelBuilderExtensions
{
	public static IKernelBuilder AddDashScopeTextGeneration(
		this IKernelBuilder builder,
		string model,
		string apiKey,
		Uri? endpoint = null,
		string? serviceId = null,
		HttpClient? httpClient = null)
	{
		builder.Services.AddKeyedSingleton<ITextGenerationService>(serviceId, (serviceProvider, _) =>
			new DashScopeTextGenerationService(model, apiKey, endpoint, HttpClientProvider.GetHttpClient(httpClient, serviceProvider)));

		return builder;
	}
}
```

这些做完后，就可以尝试通过SemanticKernel调用通义千问：

```csharp
var kb = Kernel.CreateBuilder();
kb.AddDashScopeTextGeneration("qwen-max",Environment.GetEnvironmentVariable("DashScopeApiKey")!);
var sk = kb.Build();

sk.PromptRendered += (s, e) => Console.WriteLine($"Prompt: \n{e.RenderedPrompt}\n");

var prompt = @"你是一只猫咪，你在说话时会在每句话的末尾带一声喵。
现在请你写一首关于{{$input}}的诗。";

var meow = sk.CreateFunctionFromPrompt(prompt);

string text1 = @"小鱼干";
var c = await sk.InvokeAsync(meow, new() { ["input"] = text1 });

Console.WriteLine($"\nMeow:\n{c}");
```

运行`dotnet run`，查看输出：
![](/sk-qwen/output.png)

## 流式响应

为了增强用户体验，最好是使用SSE来进行流式响应，即不等待模型生成完所有的文字，而是不停地把已经生成的文字提供给用户。

在SemanticKernel里，需要通过实现`ITextGenerationService.GetStreamingTextContentsAsync`来提供流式内容，在`DashScopeClient`中，也需要对流内容进行处理：

```csharp
    public async IAsyncEnumerable<StreamingTextContent> StreamGenerateTextAsync(
        string prompt,
        PromptExecutionSettings? executionSettings,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
		// ...
        httpRequestMessage.Headers.Add("X-DashScope-SSE", "enable"); // 开启SSE

        using var response = await SendRequestAndGetResponseImmediatelyAfterHeadersReadAsync(httpRequestMessage, cancellationToken)
            .ConfigureAwait(false);

        using var responseStream = await response.Content.ReadAsStreamAndTranslateExceptionAsync()
            .ConfigureAwait(false);

        var s = SseAsyncEnumerator<TextGenerationResponse>.EnumerateFromSseStream(
            responseStream,
            e => JsonSerializer.Deserialize<TextGenerationResponse>(e)!,
            cancellationToken);

        await foreach (TextGenerationResponse res in s)
        {
            if (res.ErrorMessage != null) throw new KernelException($"Error from model: {res.ErrorMessage}, code: {res.ErrorCode}");
            if (res.Output!.Choices is null) continue;
            for (int i = 0; i < res.Output!.Choices!.Count; i++)
            {
                var choice = res.Output!.Choices![i];
                yield return new StreamingTextContent(choice.Message.Content, i, this._modelId, choice, encoding: Encoding.UTF8, metadata: GetChoiceMetadata(res, choice));
            }
        }
    }
```

这里比较麻烦的一点是在当前版本的.NET，`HttpClien`不支持直接解析SSE响应，所以需要自己手动去解析SSE响应内容，SSE响应内容类似这样：
```log
id:1
event:result
data:{"output":{"finish_reason":"null","text":"最近"},"usage":{"output_tokens":3,"input_tokens":85},"request_id":"1117fb64-5dd9-9df0-a5ca-d7ee0e97032d"}

id:2
event:result
data:{"output":{"finish_reason":"null","text":"最近的公园是公园，它"},"usage":{"output_tokens":11,"input_tokens":85},"request_id":"1117fb64-5dd9-9df0-a5ca-d7ee0e97032d"}

... ... ... ...
... ... ... ...

id:8
event:result
data:{"output":{"finish_reason":"stop","text":"最近的公园是公园，它距离你的家大约1.5公里。你可以使用Google地图或者百度地图来查看具体的路线和距离。"},"usage":{"output_tokens":51,"input_tokens":85},"request_id":"1117fb64-5dd9-9df0-a5ca-d7ee0e97032d"}
```

如何解析SSE响应可以参考`Azure/azure-sdk-for-net/blob/main/sdk/openai/Azure.AI.OpenAI/src/Helpers/SseAsyncEnumerator.cs`

最后，在使用SemanticKernel调用时，也要调用流式方法：
```csharp
await foreach (var c in sk.InvokeStreamingAsync(meow, new() { ["input"] = text1 }))
{
    Console.Clear();
    Console.WriteLine($"\nMeow:\n{c}");
}
```