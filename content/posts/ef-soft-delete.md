---
title: "在EF Core中使用拦截器实现自动软删除"
date: 2023-06-30T00:00:00Z
---

拦截器(Interceptor)是EF Core中的一种中间件形式的组件，可以用于在EF Core的工作流中注入用户代码，以进行拦截、修改一些特定的EF Core操作。

下面以实现软删除为例。

## EF Core中删除实体的流程

在EF Core中，通常所有对实体的写操作（增删改）都需要被追踪，EF Core通过对实体对象进行追踪，对比并记录其状态变更，从而生成相应的数据库SQL语句。

当我们调用`DbContext.Remove(entity001)`时，其内部逻辑为：
```csharp
// 获取此实体的入口（Entry），EntityEntry就像一个装着实体的瓶子，瓶子上贴着标签，表示着这个瓶子里的实体即将被同步到数据库中的变更
var entry = new EntityEntry(entity);

var initialState = entry.State;

// 如果这是一个未被跟踪(Detached)的实体，则将实体的状态设置为已跟踪但没有发生变更(Unchanged)
if (initialState == EntityState.Detached)
{
	SetEntityState(entry.GetInfrastructure(), EntityState.Unchanged);
}

// An Added entity does not yet exist in the database. If it is then marked as deleted there is
// nothing to delete because it was not yet inserted, so just make sure it doesn't get inserted.
// 如果此实体的初始状态为已添加(Added)，这意味着这个实体即将（但还没有）被插入到数据库中，此时只需要将其状态更改为`Detached`来保证这次数据插入不会发生即可
// 否则，则标记此实体状态为已删除(Deleted)，在稍后调用SaveChanges方法时，EF Core会生成并执行相应的删除语句
entry.State =
	initialState == EntityState.Added
		? EntityState.Detached
		: EntityState.Deleted;

```

## 软删除

通常，实现软删除是通过设置一个类似`IsDeleted`的字段，在删除实体时，将字段值更新为`true`，并在查询时，过滤掉所有`IsDeleted=true`的记录

这就需要对实体模型进行相关配置：

```csharp
public static EntityTypeBuilder<TEntity> EnableSoftDelete<TEntity>(
	this EntityTypeBuilder<TEntity> builder)
	where TEntity : class
{
	// 添加一个注释，标志着此实体启用了软删除
	builder.HasAnnotation("soft_delete", true);

	// 添加相关字段
	builder.Property<bool?>("is_deleted")
		.HasDefaultValue(false);
	builder.HasIndex("is_deleted");
	builder.Property<DateTimeOffset?>("deleted_at")
		.HasDefaultValue(null);
	builder.Property<string?>("deleted_by")
		.HasDefaultValue(null);

	// 配置查询过滤器，在查询时，使其忽略所有is_deleted字段值为true的记录
	builder.HasQueryFilter(x => EF.Property<bool?>(x, "is_deleted") != true);
	return builder;
}

```


## 使用Interceptor拦截EF Core对实体的删除操作

创建一个`SoftDeleteInterceptor`，实现`ISaveChangesInterceptor`接口：
```csharp
public class SoftDeleteInterceptor : ISaveChangesInterceptor
{
	public ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default) { }

	public ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default) { }

#if NET6_0
    public InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result) => result;
    public int SavedChanges(SaveChangesCompletedEventData eventData, int result) => result;
    public void SaveChangesFailed(DbContextErrorEventData eventData) { }
    public Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default) => Task.CompletedTask;
#endif
}
```

`ISaveChangesInterceptor`用于拦截EF Core的`SaveChanges`行为，其中`SavingChanges`会在`SaveChanges`操作之前触发，`SavedChanges`会在`SaveChanges`成功后触发，而`SaveChangesFailed`会在`SaveChanges`失败后触发

这里我们只需要实现`SavingChangesAsync`和`SaveChangesFailedAsync`即可（以及它们对应的同步方法，这里忽略了）

在`SavingChangesAsync`中，我们需要将EF Core的删除操作拦截，改为更新操作：
```csharp
public ValueTask<InterceptionResult<int>> SavingChangesAsync(
	DbContextEventData eventData,
	InterceptionResult<int> result,
	CancellationToken cancellationToken = default)
{
	var context = eventData.Context!;
	// 获取所有状态为`Deleted`并被标记为软删除的实体
	var deletedEntities = context.ChangeTracker.Entries().Where(entry => entry.State == EntityState.Deleted && entry.Metadata.FindAnnotation(Annotations.SoftDelete) is not null);
	foreach (var entry in deletedEntities)
	{
		// 将实体状态改为Modified，稍后EF Core则会因此对此实体生成并执行更新语句
		entry.State = EntityState.Modified;
        entry.CurrentValues[PropertyNames.IsDeleted] = true;
        entry.CurrentValues[PropertyNames.DeletedAt] = DateTimeOffset.UtcNow;
        entry.CurrentValues[PropertyNames.DeletedBy] = GetOperator();
		// 添加一个运行时注释，记录此实体已被软删除
        entry.Metadata.AddRuntimeAnnotation(Annotations.HasSoftDeleted, null);
	}

	return ValueTask.FromResult(result);
}
```

在`SavedChangesAsync`中，找到被软删除后的实体，将其状态同步为`Detached`，来保证其一致：
```csharp
var softDeletedEntries = eventData.Context!.ChangeTracker.Entries().Where(entry => entry.Metadata.FindRuntimeAnnotation(Annotations.HasSoftDeleted) != null);
foreach (var entries in softDeletedEntries)
{
	entries.State = EntityState.Detached;
}
return ValueTask.FromResult(result);
```

### 启用软删除拦截器

通常通过覆写`DbContext.OnConfiguring`方法来启用拦截器：
```
public class MyContext : DbContext
{
    private readonly SoftDeleteInterceptor _softDeleteInterceptor = new SoftDeleteInterceptor();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder
            .AddInterceptors(_softDeleteInterceptor)
}
```

拦截器启用后，即可将EF Core的删除操作拦截修改为更新操作，实现软删除
可以通过不适用过滤器的查询来进行验证：
```csharp
var deleted = await dbContext.Set<MyEntity>().IgnoreQueryFilters().FirstOrDefaultAsync();
deleted.Should().NotBeNull();
```

## 缺陷

这种方案还有着一些缺陷，比如：
1. 无法对引用实体进行级联的软删除
2. 无法“硬”删除，这个问题可以通过使用添加一个`RuntimeAnnotation`来解决

## 拦截器的更多用法

拦截器还有一些其它玩法，比如[官方文档](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors#savechanges-interception)中介绍了一个自动生成审计记录的案例

另外也许还能利用拦截器实现一个简易的'Change Data Capture'机制，但是感觉不是很靠谱，不在数据库上做CDC的话，数据可靠性不够


