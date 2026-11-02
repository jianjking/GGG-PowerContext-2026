"""示例业务工程：一个极小的四则运算模块。"""


def add(a, b):
    return a + b


def divide(a, b):
    # 规则 DIV-1：除数为 0 时抛出 ValueError，信息固定
    if b == 0:
        raise ValueError("divisor must be non-zero")
    # 规则 DIV-2：其余输入行为不变
    return a / b
