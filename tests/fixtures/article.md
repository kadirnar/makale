# Reliable model evaluation

The Transformer uses attention. GPU memory was 24 GB, and accuracy was 92.5% on the held-out dataset [1].

## Objective

The objective is $L = -\sum_i y_i \log p_i$.

$$\operatorname{Attention}(Q,K,V) = \operatorname{softmax}(QK^T / \sqrt{d_k})V$$

```python
loss = -(target * prediction.log()).sum()
```

## Evidence

| Setting    | Reported value |
| ---------- | -------------- |
| Batch size | 32             |
| Optimizer  | AdamW          |

The study does not report the GPU model, training duration, or dataset license. These gaps limit reproducibility.
