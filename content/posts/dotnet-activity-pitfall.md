---
title: .NET Activity API中的一个小陷阱
date: 2022-01-27T00:00:00Z
---

最近在为Orleans改进其分布式追踪组件([Use DistributedContextPropagator to propagate Activities](https://github.com/dotnet/orleans/pull/7443))的时候，从AspNetCore中抄了一些代码:

``` csharp
// https://github.com/dotnet/aspnetcore/blob/9da42b9fab4c61fe46627ac0c6877905ec845d5a/src/Hosting/Hosting/src/Internal/HostingApplicationDiagnostics.cs#L272

private Activity? StartActivity(HttpContext httpContext, bool loggingEnabled, bool diagnosticListenerActivityCreationEnabled, out bool hasDiagnosticListener)
{
	var activity = _activitySource.CreateActivity(ActivityName, ActivityKind.Server);
	// ...
	var headers = httpContext.Request.Headers;
	_propagator.ExtractTraceIdAndState(headers,
		static (object? carrier, string fieldName, out string? fieldValue, out IEnumerable<string>? fieldValues) =>
		{
			fieldValues = default;
			var headers = (IHeaderDictionary)carrier!;
			fieldValue = headers[fieldName];
		},
		out var requestId,
		out var traceState);

	// ...
	activity.SetParentId(requestId);
	if (!string.IsNullOrEmpty(traceState))
	{
		activity.TraceStateString = traceState;
	}
}
```

这段代码的作用是，创建Activity后，从请求头中尝试获取追踪信息（traceid等），如果存在的话，就通过`activity.SetParentId(requestId)`将这个新创建的Activity与请求头中的追踪上下文关联，即进入链路成为其中的一个子片段。

这个逻辑看起来没什么问题，也有相关的单元测试覆盖，于是我把这段代码抄到了Orleans里并最终合并进主干，但是不久后有一个开发者提了issue，报告了其中的问题——
> 在使用OpenTelemetry SDK捕获Activities从而产生分布式追踪信息后，这些Activity所代表的Span并没有根据请求链路关联起来，而是各自成为了独立的链路。

这就十分令人好奇了——这是从AspNetCore代码库里抄来的代码，也有相关测试覆盖，为什么还会有问题？ 
于是使用OpenTelemetry SDK重现了这个bug并仔细调试后，发现了问题出现的原因：

OpenTelemetry SDK记录应用的Activity时，有一个默认的采样器(Sampler)，在这个采样器中它会在创建Activity时访问相关`ActivityCreationOptions`中的`.TraceId`属性，再看其源码：

```csharp
// https://github.com/dotnet/runtime/blob/970d347a1b06951692cfecc1cc12a500158708b1/src/libraries/System.Diagnostics.DiagnosticSource/src/System/Diagnostics/ActivityCreationOptions.cs#L128
public ActivityTraceId TraceId
{
	get
	{
		if (Parent is ActivityContext && IdFormat == ActivityIdFormat.W3C && _context == default)
		{
			Func<ActivityTraceId>? traceIdGenerator = Activity.TraceIdGenerator;
			ActivityTraceId id = traceIdGenerator == null ? ActivityTraceId.CreateRandom() : traceIdGenerator();

			Unsafe.AsRef(in _context) = new ActivityContext(id, default, ActivityTraceFlags.None);
		}

		return _context.TraceId;
	}
}
```

也就是说，访问`.TraceId`时，如果它还没有traceid，就生成一个并返回，最终被配置到新创建的Activity中，而Activity的TraceId只能被配置一次，也就是说如果traceid已经存在，后面的`activity.SetParentId(requestId)`就不会产生作用。

所以最终，每个Activity都单独生成了自己的traceid，没有使用进入父级链路。

查看`SetParentId`这个API的文档时，也发现了建议谨慎使用的注释：
> This is intended to be used only at 'boundary' scenarios where an activity from another process logically started this activity.

#### 为什么单元测试里没有问题？  
  
  单元测试里虽然也使用了采样器，但是并没有在采样器中访问`TraceId`，所以不会出现上述问题，而在采样器中加入了对`TraceId`的访问后，也成功复现了这个bug

#### 为什么OpenTelemetry SDK采集AspNetCore的Activities就没有这个问题？
  
  因为OpenTelemetry SDK没有直接采集AspNetCore生成的Activities，而是hook了相关生命周期事件，生成并采集自定义的Activities，如果它直接采集AspNetCore产生的Activities，也会有这个问题，这是AspNetCore代码中的一个缺陷，有一个[issue](https://github.com/dotnet/aspnetcore/issues/37471#issuecomment-972083624)记录了它


总结和教训：
* 只有单元测试是不够的，还要进行端到端的测试
* 不能盲目信任“权威”代码，它也有bug
* 这种明明只是访问一个属性却产生了副作用的做法是不好的，一方面它容易引入错误，另一方面出错后也很难进行相关的debug
