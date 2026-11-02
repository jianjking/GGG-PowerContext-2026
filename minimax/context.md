# 开发上下文

任务：除数为 0 时应该抛出 ValueError

## 适用规格
- `specs/divide.md` — 规格：divide 的除零行为

## 需要修改的代码
- `calc.py` → `add`
- `calc.py` → `divide`

## 验证用测试
- `test_calc.py` → `TestCalc`
- `test_calc.py` → `test_add`
- `test_calc.py` → `test_divide_ok`
- `test_calc.py` → `test_divide_by_zero`
