# 规格：divide 的除零行为
tags: spec,calc,error-handling

## 规则 DIV-1
`divide(a, b)` 在 `b == 0` 时必须抛出 `ValueError`，异常信息固定为 `divisor must be non-zero`。

## 规则 DIV-2
除零以外的输入，`divide` 的行为保持不变（返回 a / b 的浮点结果），不得引入新的异常类型。

## 影响面
- 代码：`calc.py` 中的 `divide`
- 测试：`test_calc.py::test_divide_by_zero`（目标测试）、`test_calc.py::test_add` 与 `test_divide_ok`（回归）
