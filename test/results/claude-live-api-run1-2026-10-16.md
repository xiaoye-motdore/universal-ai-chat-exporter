---
title: "Binary search explanation"
platform: "claude"
source: "https://claude.ai/chat/3cd6be68-534d-4ed9-8de5-60e625be5b3f"
conversation_id: "3cd6be68-534d-4ed9-8de5-60e625be5b3f"
model: "claude-opus-5-5"
created: "2026-10-16T03:47:43.397Z"
exported: "2026-10-16T03:59:48.232Z"
extraction: "api"
completeness: "complete"
messages: 2
---

# Binary search explanation

## User — 2026-10-16 03:47:43 UTC

Bookmarklet export test. Explain binary search in 2 sentences, then give a short Python code block, a 2-row markdown table of best and worst case, and the formula for the number of steps in LaTeX. Finally create a tiny HTML artifact that shows the text 'hello'.

---

## Assistant — 2026-10-16 03:47:51 UTC

Building the hello artifact first, then the full answer below it.

*[Tool: Skill]*

*[Tool: Write]*

*[Tool: Artifact]*

Binary search finds a target in a sorted list by comparing it to the middle element and discarding the half that can't contain it. Each step halves the search range, so it runs in logarithmic time.

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

| Case | Time complexity |
|------|-----------------|
| Best | O(1), target is the first middle element |
| Worst | O(log n), target absent or found at the last step |

Maximum number of comparisons for a list of n elements:

$$
k = \lfloor \log_2 n \rfloor + 1
$$

The "hello" artifact is published as a single-word test page, styled for both light and dark themes.
