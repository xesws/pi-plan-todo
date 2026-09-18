# RAG Embedding 方案

## 结论
- Embedding 模型：bge-m3（中英双语，兼顾检索质量与成本）
- 向量维度：1024
- 索引结构：HNSW（M=16, efConstruction=200），按 `partitionKey` 做命名空间隔离

## 待验证
- 维度 1024 vs 768 在业务语料上的 recall@k 对比
- HNSW 查询 efSearch 与延迟的权衡
