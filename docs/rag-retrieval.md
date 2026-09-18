# RAG 检索链路设计

## 结论
- Chunk 策略：512 token 滑动窗口，重叠 64，保证上下文连续
- Rerank：初排 top-20，reranker 精排取 top-5
- 引用：答案必须带原文引用，回退到“无相关上下文”而不是幻觉

## 待验证
- chunk 大小对长文档问答的影响
- reranker 延迟预算（p99 < 300ms）
