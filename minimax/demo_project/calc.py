"""示例业务工程：一个极小的四则运算模块。"""


def add(a, b):
    return a + b


def divide(a, b):
    # 规范要求：除数为 0 时抛出 ValueError
    # 当前实现直接做除法，会抛 ZeroDivisionError —— 这正是本次任务要改的地方
    return a / b
