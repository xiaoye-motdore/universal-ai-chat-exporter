<!-- Captured from the real chatgpt.com page (logged-out chat, /uc/ URL) by injecting the built bookmarklet
     (build sha256 76eb0fa7…) and clicking "Markdown". Run 1: the "python" label leaked and the fence lost its
     language because comment nodes sit between the label and <pre>; fixed in the next build. -->
---
title: "Untitled conversation"
platform: "chatgpt"
source: "https://chatgpt.com/uc/6ad19a2a-62d0-83ea-b5d5-cc0e30b5fe0a"
conversation_id: "6ad19a2a-62d0-83ea-b5d5-cc0e30b5fe0a"
model: ""
created: ""
exported: "2026-10-16T03:36:25.730Z"
extraction: "dom"
completeness: "partial"
messages: 2
---

# Untitled conversation

> **Warning:** Read from the rendered page because the API was unavailable. Only loaded messages are included. (not signed in (no session token))

## User

Explain quicksort in 3 sentences, then show a short Python code block and a 2-row markdown table of best/worst case complexity, and the formula for average complexity in LaTeX.

---

## Assistant

Quicksort is a sorting algorithm that selects a pivot element and partitions the array so that smaller elements go to its left and larger elements go to its right. It then recursively sorts the two partitions until the array is sorted. Quicksort typically runs in $O(n\log n)$ time on average, but poor pivot choices can lead to $O(n^2)$ time in the worst case.

### Python implementation

python

```
def quicksort(arr):
    if len(arr) <= 1:
        return arr

    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]

    return quicksort(left) + middle + quicksort(right)

print(quicksort([5, 2, 8, 1, 9, 3]))
# [1, 2, 3, 5, 8, 9]
```

### Time complexity

| Case | Time complexity |
| --- | --- |
| Best case | $O(n\log n)$ |
| Worst case | $O(n^2)$ |

### Average-case complexity formula

The average-case time complexity is:

$$
\boxed{T(n)=\Theta(n\log n)}
$$

More precisely, for randomized quicksort with distinct elements, the expected number of comparisons is:

$$
\mathbb{E}[C_n]
=2(n+1)H_n-4n
$$

where $H_n=\sum_{k=1}^{n}\frac{1}{k}$ is the $n$-th harmonic number, and $H_n\approx\ln n+\gamma$. Thus, the expected number of comparisons grows proportionally to $n\log n$.
