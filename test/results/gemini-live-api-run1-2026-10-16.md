---
title: "Binary Search Explanation and Code - Google Gemini"
platform: "gemini"
source: "https://gemini.google.com/app/b02db24bfa9b1078"
conversation_id: "b02db24bfa9b1078"
model: ""
created: "2026-10-16T03:47:45.000Z"
exported: "2026-10-16T04:04:13.968Z"
extraction: "api"
completeness: "complete"
messages: 2
---

# Binary Search Explanation and Code - Google Gemini

## User — 2026-10-16 03:47:45 UTC

Bookmarklet export test. Explain binary search in 2 sentences, then give a short Python code block, a 2-row markdown table of best and worst case, and the formula for the number of steps in LaTeX.

---

## Assistant — 2026-10-16 03:47:45 UTC

> *This message has 2 versions (edited or regenerated); the selected version is shown.*

Binary search is an efficient search algorithm that finds the position of a target value within a sorted array by repeatedly dividing the search interval in half. It compares the target to the middle element, immediately returning if a match is found or narrowing the interval to the left or right subarray accordingly.

```python
def binary_search(arr, target):
    low, high = 0, len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1
```

| Case | Time Complexity | Scenario |
| :--- | :--- | :--- |
| **Best Case** | $O(1)$ | Target element is located at the middle index on the first check |
| **Worst Case** | $O(\log n)$ | Target is at an extreme end or not present in the array |

The maximum number of steps (comparisons) required for an array of size $n$ is given by:

$$k = \lfloor \log_2(n) \rfloor + 1$$
