export const sample = `# A closer look at attention

A short reading example · Makale studio

## Understanding the mechanism

The Transformer architecture uses attention to let each token gather information from other tokens. Instead of compressing a whole sequence into a single fixed representation, it computes a weighted combination of relevant representations.

The central operation is scaled dot-product attention:

$$\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$

Here, queries, keys, and values play different roles. The scale factor controls the magnitude of the dot products. This is a mathematical expression, so the translator keeps it intact.

## Why several heads?

Multi-head attention allows the model to combine information from different representation subspaces. Different heads can learn different patterns, although a particular interpretation of a head should be supported by evidence.

| Concept | Role |
| --- | --- |
| Query | Determines what information is relevant |
| Key | Provides a representation to compare with a query |
| Value | Contributes information to the weighted result |

\`\`\`python
scores = (query @ key.T) / math.sqrt(d_k)
weights = scores.softmax(dim=-1)
output = weights @ value
\`\`\`

## A careful reader's questions

What evidence would demonstrate an improvement? Which baseline is used? Are training data, compute, and evaluation conditions comparable? A useful review separates the author's claims from the evidence available in the article.

This example is an educational explanation, not a research paper. It does not report a training run, dataset, GPU configuration, or benchmark results. A responsible report should mark these details as not reported rather than guessing.
`;
